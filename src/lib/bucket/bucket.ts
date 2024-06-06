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
import { Controller } from '@lib/controller'
import { Img } from '@lib/image'
import { Logger } from '@lib/logger'
import { RenderRequest, RenderRequestEvent } from '@lib/request'
import { now, UNITS, UnitsType } from '@utils'

export type BucketEventTypes =
  | 'progress'
  | 'loadend'
  | 'error'
  | 'rendered'
  | 'clear'
  | 'loading'
  | 'request-rendered'
  | 'request-loadend'
  | 'render-progress'
  | 'update'

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
  (T extends 'update' ? { requests: number; images: number } : unknown)

export type BucketEventHandler<T extends BucketEventTypes> = (
  event: BucketEvent<T>,
) => void

export interface BucketProps {
  /** The name of the bucket */
  name?: string
  /** Whether the bucket is locked */
  lock?: boolean
  /** The controller instance */
  controller: Controller
}

/**
 * Represents a bucket of images and their associated render requests.
 * Emits events when images are loaded, when the bucket is cleared, and when the bucket is rendered.
 * Also tracks the loading state of the bucket and the progress of the loading operation.
 */
export class Bucket extends Logger {
  readonly requests = new Set<RenderRequest>()
  readonly videoMemory = new Map<string, Set<Img>>()
  static bucketNumber = 0
  rendered = false
  loading = false
  loaded = false
  loadProgress = 0
  timeout = 0
  controller: Controller
  locked: boolean

  constructor({ name, lock = false, controller }: BucketProps) {
    super({
      name: name || (Bucket.bucketNumber++).toString(),
      logLevel: 'error',
    })
    this.controller = controller
    this.locked = lock
  }

  registerRequest(request: RenderRequest) {
    this.requests.add(request)
    request.on('loadstart', this.#onRequestLoadStart)
    request.on('progress', this.#onRequestProgress)
    request.on('error', this.#onRequestError)
    request.on('loadend', this.#onRequestLoadEnd)
    request.on('rendered', this.#onRequestRendered)
    request.on('clear', this.#onRequestClear)
    this.emit('update', {
      requests: this.requests.size,
      images: this.getImages().size,
    })
  }

  #onRequestClear = (event: RenderRequestEvent<'clear'>) => {
    this.requests.delete(event.target)
    event.target.off('loadstart', this.#onRequestLoadStart)
    event.target.off('progress', this.#onRequestProgress)
    event.target.off('error', this.#onRequestError)
    event.target.off('loadend', this.#onRequestLoadEnd)
    event.target.off('rendered', this.#onRequestRendered)
    event.target.off('clear', this.#onRequestClear)
    this.emit('update', {
      requests: this.requests.size,
      images: this.getImages().size,
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
  #onRequestProgress = (event: RenderRequestEvent<'progress'>): void => {
    this.loaded = false
    this.loading = true
    let progress = 0
    const images = this.getImages()
    for (const image of images) {
      progress += image.progress
    }
    this.loadProgress = progress / images.size
    this.emit('progress', { progress: this.loadProgress })
    this.log.verbose([
      `Progress ${this.name}: ${this.loadProgress}`,
      'event:',
      event,
    ])
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
    const images = this.getImages()
    for (const image of images) {
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
   * Get all unique images in the bucket
   */
  getImages() {
    return new Set(Array.from(this.requests).map(request => request.image))
  }

  //-----------------------   EVENT METHODS   -----------------------

  /**
   * Adds an event listener for the specified event type.
   * @param event - The type of the event.
   * @param handler - The event handler function.
   * @returns The current instance of the Bucket.
   * @override Logger.on
   */
  on<T extends BucketEventTypes>(
    event: T,
    handler: BucketEventHandler<T>,
  ): this {
    return super.on(event, handler)
  }

  /**
   * Removes an event listener for the specified event type.
   * @param event - The type of the event.
   * @param handler - The event handler function to remove.
   * @returns The current instance of the Bucket.
   * @override Logger.off
   */
  off<T extends BucketEventTypes>(
    event: T,
    handler: BucketEventHandler<T>,
  ): this {
    return super.off(event, handler)
  }

  /**
   * Emits an event of the specified type with the specified data.
   * @param type - The type of the event to emit.
   * @param data - The data to emit with the event.
   * @returns True if the event was emitted successfully, false otherwise.
   * @override Logger.emit
   */
  emit<T extends BucketEventTypes>(
    type: T,
    data?: Omit<BucketEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(type, {
      ...data,
      type,
      target: this,
    })
  }
}
