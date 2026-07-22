/**
 * The `Bucket` class manages a set of images and their associated render requests.
 * It extends the `Logger` class, inheriting its logging capabilities.
 *
 * The `Bucket` class maintains a set of `Img` instances, a set of `RenderRequest` instances,
 * and a map of video memory usage by image.
 *
 * The `Bucket` class also maintains several state properties, such as `rendered`, `loading`, `loaded`, `loadProgress`, and `timeout`.
 *
 * The `Bucket` class provides methods to register and unregister a `RenderRequest`,
 * which involves adding or removing the `RenderRequest` from the set,
 * subscribing or unsubscribing to the "rendered" event, and adding or removing the image from the set of images.
 */
import { type Controller } from '@lib/controller'
import { type Img } from '@lib/image'
import { Logger } from '@lib/logger'
import { type RenderRequest, type RenderRequestEvent } from '@lib/request'
import { now, UNITS, type UnitsType } from '@utils'

export type BucketEventTypes =
  | 'progress'
  | 'loadend'
  | 'error'
  | 'rendered'
  | 'clear'
  | 'loading'
  | 'pause'
  | 'resume'
  | 'request-rendered'
  | 'request-loadend'
  | 'render-progress'
  | 'update'
  | 'video-overflow'

type ProgressEvent = {
  /** The progress of the loading operation */
  progress: number
}

type LoadEvent = {
  /** The loading state */
  loaded: boolean
}
type RenderEvent = {
  /** The rendered state */
  rendered: boolean
}

type RequestRenderedEvent = {
  /** The request that was rendered */
  request: RenderRequest
}

type RequestLoadEndEvent = {
  /** The request that was rendered */
  request: RenderRequest
}

export type BucketRamBytes = {
  /** The compressed RAM bytes used by the bucket */
  compressed: number
  /** The uncompressed RAM bytes used by the bucket */
  uncompressed: number
  /** The total RAM bytes used by the bucket */
  total: number
}

export type BucketVideoBytes = {
  /** The requested video memory bytes used by the bucket (not rendered) */
  requested: number
  /** The used video memory bytes used by the bucket (rendered) */
  used: number
}

export type BucketVideoUnits = {
  /** The requested video memory units used by the bucket (not rendered) */
  requested: number
  /** The used video memory units used by the bucket (rendered) */
  used: number
  /** The ratio of the units to bytes */
  ratio: number
  /** The type of units. */
  type: UnitsType
}

export type BucketRamUnits = {
  /** The compressed RAM units used by the bucket */
  compressed: number
  /** The uncompressed RAM units used by the bucket */
  uncompressed: number
  /** The total RAM units used by the bucket */
  total: number
  /** The ratio of the units to bytes */
  ratio: number
  /** The type of units. */
  type: UnitsType
}

export type BucketEvent<T extends BucketEventTypes> = {
  /** The type of the event */
  type: T
  /** The target of the event */
  target: Bucket
} & (T extends 'progress' | 'render-progress' ? ProgressEvent : unknown) &
  (T extends 'error' ? RenderRequestEvent<'error'> : unknown) &
  (T extends 'loadend' ? LoadEvent : unknown) &
  (T extends 'rendered' ? RenderEvent : unknown) &
  (T extends 'request-rendered' ? RequestRenderedEvent : unknown) &
  (T extends 'request-loadend' ? RequestLoadEndEvent : unknown) &
  (T extends 'loading' ? { request: RenderRequest } : unknown) &
  (T extends 'update' ? { requests: number; images: number } : unknown) &
  (T extends 'video-overflow' ? { bytes: number } : unknown)

export type BucketEventHandler<T extends BucketEventTypes> = (
  event: BucketEvent<T>,
) => void

/** Strict event map for the Bucket (see Emitter) */
export type BucketEventMap = {
  [K in BucketEventTypes]: BucketEvent<K>
}

export interface BucketProps {
  /** The name of the bucket */
  name?: string
  /** Whether the bucket is locked */
  lock?: boolean
  /**
   * Scheduling priority for this bucket's render requests. Higher renders
   * first (e.g. focused/visible rail: 1, off-screen rails: 0). Requests may
   * override it individually.
   */
  priority?: number
  /**
   * Optional GPU-memory cap for THIS bucket, in the controller's units.
   * When the bucket's rendered warms exceed it, its own oldest unlocked
   * requests are evicted (the global video budget still applies on top).
   * There is deliberately no per-bucket RAM cap: images are shared across
   * buckets by URL, so per-bucket RAM would be ill-defined.
   */
  videoBudget?: number
  /** The controller instance */
  controller: Controller
}

/**
 * Represents a bucket of images and their associated render requests.
 * Emits events when images are loaded, when the bucket is cleared, and when the bucket is rendered.
 * Also tracks the loading state of the bucket and the progress of the loading operation.
 */
export class Bucket extends Logger<BucketEventMap> {
  readonly requests = new Set<RenderRequest>()
  /** Unique images referenced by this bucket's requests, refcounted */
  readonly #imageRefs = new Map<Img, number>()
  static bucketNumber = 0
  rendered = false
  loading = false
  loaded = false
  loadProgress = 0
  controller: Controller
  locked: boolean
  /** Scheduling priority inherited by this bucket's render requests */
  priority: number
  #paused = false
  /** Per-bucket GPU cap in bytes (null = uncapped) */
  #videoBudgetBytes: number | null = null

  constructor({
    name,
    lock = false,
    priority = 0,
    videoBudget,
    controller,
  }: BucketProps) {
    super({
      name: name || (Bucket.bucketNumber++).toString(),
      logLevel: 'error',
    })
    this.controller = controller
    this.locked = lock
    this.priority = priority

    if (videoBudget !== undefined) {
      this.setVideoBudget(videoBudget)
    }
  }

  /** True while pause()d — the frame queue skips this bucket's requests */
  get paused(): boolean {
    return this.#paused
  }

  /**
   * Pauses warming for THIS bucket only (other buckets keep rendering).
   * Loading continues — decode-ahead is safe off-screen; only the GPU work
   * is deferred.
   */
  pause() {
    if (this.#paused) return
    this.#paused = true
    this.emit('pause')
  }

  /** Resumes warming for this bucket (wakes the frame queue). */
  resume() {
    if (!this.#paused) return
    this.#paused = false
    this.emit('resume')
    this.controller.frameQueue.wake()
  }

  /**
   * Sets/changes this bucket's GPU-memory cap at runtime (controller units;
   * null removes the cap). Over-cap warms are evicted immediately.
   */
  setVideoBudget(size: number | null) {
    this.#videoBudgetBytes =
      size === null ? null : size * UNITS[this.controller.units]
    this.#enforceVideoBudget()
  }

  /**
   * Evicts this bucket's own oldest unlocked warms while over its cap.
   * Emits 'video-overflow' when the cap cannot be honored (all locked).
   */
  #enforceVideoBudget() {
    const budget = this.#videoBudgetBytes
    if (budget === null) return
    if (this.getVideoBytes().used <= budget) return

    for (const request of this.requests) {
      if (!request.rendered || request.isLocked()) continue
      request.clear()
      if (this.getVideoBytes().used <= budget) return
    }

    const used = this.getVideoBytes().used

    if (used > budget) {
      this.emit('video-overflow', { bytes: used - budget })
    }
  }

  registerRequest(request: RenderRequest) {
    this.requests.add(request)
    this.#imageRefs.set(
      request.image,
      (this.#imageRefs.get(request.image) ?? 0) + 1,
    )
    request.on('loadstart', this.#onRequestLoadStart)
    request.on('progress', this.#onRequestProgress)
    request.on('error', this.#onRequestError)
    request.on('loadend', this.#onRequestLoadEnd)
    request.on('rendered', this.#onRequestRendered)
    request.on('clear', this.#onRequestClear)
    this.emit('update', {
      requests: this.requests.size,
      images: this.#imageRefs.size,
    })
  }

  #onRequestClear = (event: RenderRequestEvent<'clear'>) => {
    this.requests.delete(event.target)
    const refs = this.#imageRefs.get(event.target.image) ?? 0

    if (refs <= 1) {
      this.#imageRefs.delete(event.target.image)
    } else {
      this.#imageRefs.set(event.target.image, refs - 1)
    }

    event.target.off('loadstart', this.#onRequestLoadStart)
    event.target.off('progress', this.#onRequestProgress)
    event.target.off('error', this.#onRequestError)
    event.target.off('loadend', this.#onRequestLoadEnd)
    event.target.off('rendered', this.#onRequestRendered)
    event.target.off('clear', this.#onRequestClear)
    this.emit('update', {
      requests: this.requests.size,
      images: this.#imageRefs.size,
    })
  }

  hasURL(url: string) {
    for (const request of this.requests) {
      if (request.image.url === url) {
        return true
      }
    }
    return false
  }

  /**
   * When a request is rendered, check if all requests are rendered
   * @param event
   */
  #onRequestRendered = (event: RenderRequestEvent<'rendered'>) => {
    this.rendered = true
    let renderedRequests = 0
    // emit the render event only if all requests are rendered
    for (const request of this.requests) {
      this.rendered = !request.rendered ? false : this.rendered
      renderedRequests += request.rendered ? 1 : 0
    }

    this.emit('request-rendered', { request: event.target })
    this.#enforceVideoBudget()
    // current render progress
    const progress = renderedRequests / this.requests.size
    this.emit('render-progress', { progress })
    this.log.verbose([`Request Rendered ${this.name}`, now(), event.target])
    if (this.rendered) {
      this.emit('rendered')
    }
  }
  /**
   * Any image load event will reset the loading state
   * @param event
   */
  #onRequestLoadStart = (event: RenderRequestEvent<'loadstart'>) => {
    this.loading = true
    this.loaded = false
    this.rendered = false
    this.emit('loading', { request: event.target })
  }
  /**
   * This is expensive and should not be used this way
   * Instead, a getter should be used to calculate the current progress
   * @param event
   */
  #onRequestProgress = (_event: RenderRequestEvent<'progress'>): void => {
    this.loaded = false
    this.loading = true
    let progress = 0

    for (const image of this.#imageRefs.keys()) {
      progress += image.progress
    }

    this.loadProgress = this.#imageRefs.size
      ? progress / this.#imageRefs.size
      : 0
    this.emit('progress', { progress: this.loadProgress })
  }
  /**
   * When all images are loaded, emit the loaded event
   *
   * @param event
   * @returns
   */
  #onRequestLoadEnd = (event: RenderRequestEvent<'loadend'>) => {
    this.loaded = true
    for (const request of this.requests) {
      if (!request.image.loaded) {
        this.loaded = false
        break
      }
    }
    this.loading = !this.loaded
    this.emit('request-loadend', { request: event.target })
    if (this.loaded) {
      this.loadProgress = 1
      this.emit('loadend')
      this.log.info([`Loaded ${this.name}`, now()])
    }
  }
  /**
   * When an image errors, emit the error event
   * @param event
   */
  #onRequestError = (event: RenderRequestEvent<'error'>) => {
    this.emit('error', { statusText: event.statusText, status: event.status })
  }

  /**
   * Calculate the video memory used by the bucket in bytes
   */
  getVideoBytes(): BucketVideoBytes {
    let requested = 0
    let used = 0
    for (const request of this.requests) {
      requested += request.bytesVideo
      used += request.rendered ? request.bytesVideo : 0
    }

    return {
      requested,
      used,
    }
  }

  /**
   * Calculate the video memory used by the bucket in the current units
   */
  getVideoUnits(): BucketVideoUnits {
    const bytes = this.getVideoBytes()
    const ratio = UNITS[this.controller.units]
    return {
      requested: bytes.requested / ratio,
      used: bytes.used / ratio,
      ratio,
      type: this.controller.units,
    }
  }

  /**
   * Calculate the ram used by the bucket
   */
  getRamBytes(): BucketRamBytes {
    let compressedBytes = 0
    let uncompressedBytes = 0

    for (const image of this.#imageRefs.keys()) {
      compressedBytes += image.bytes
      uncompressedBytes += image.bytesUncompressed
    }

    return {
      compressed: compressedBytes,
      uncompressed: uncompressedBytes,
      total: compressedBytes + uncompressedBytes,
    }
  }

  /**
   * Calculate the ram used by the bucket in the current units
   */
  getRamUnits(): BucketRamUnits {
    const ratio = UNITS[this.controller.units]
    const bytes = this.getRamBytes()
    return {
      compressed: bytes.compressed / ratio,
      uncompressed: bytes.uncompressed / ratio,
      total: bytes.total / ratio,
      ratio,
      type: this.controller.units,
    }
  }

  /**
   * Clear all images from the bucket
   * This will also remove all event listeners
   */
  clear = () => {
    for (const request of this.requests) {
      request.clear()
    }
    this.requests.clear()
    this.emit('clear')
    this.removeAllListeners()
  }

  /**
   * Get all unique images in the bucket (refcounted — O(images) snapshot)
   */
  getImages(): Set<Img> {
    return new Set(this.#imageRefs.keys())
  }

  /**
   * Changes this bucket's scheduling priority on the fly — e.g. the focused
   * rail changed — and applies it to every request in the bucket (pending
   * requests re-sort in the frame queue immediately).
   */
  setPriority(priority: number) {
    this.priority = priority

    for (const request of this.requests) {
      request.setPriority(priority)
    }
  }

  //-----------------------   EVENT METHODS   -----------------------

  /**
   * Emits an event, injecting `type` and `target`.
   * `on`/`off` are inherited fully-typed from the strict Emitter base.
   */
  emit<T extends BucketEventTypes>(
    type: T,
    data?: Omit<BucketEvent<T>, 'target' | 'type'>,
  ): boolean {
    return this.dispatch(type, {
      ...data,
      type,
      target: this,
    })
  }
}
