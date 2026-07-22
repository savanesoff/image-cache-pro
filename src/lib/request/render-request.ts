/**
 * Module for rendering requests.
 * Each request is associated with an image and a bucket. Where an image can
 * have multiple requests associated with it, a bucket can have multiple images
 */
import { type Bucket } from '@lib/bucket'
import { type FrameQueue } from '@lib/frame-queue'
import { type Img, type ImgEvent, type ImgProps } from '@lib/image'
import { Logger } from '@lib/logger'
import { renderer as defaultRenderer } from '@lib/renderer'
import { microtask, type Size } from '@utils'

export type RenderRequestProps = ImgProps & {
  /** Target render size. Required — enables the image-decoder bypass. */
  size: Size
  /** The bucket this request belongs to */
  bucket: Bucket
  /**
   * Scheduling priority. Higher renders first. Defaults to the bucket's
   * priority. A focused rail should out-prioritise off-screen rails.
   */
  priority?: number
}

export type RenderRequestEventTypes =
  | 'rendered'
  | 'clear'
  | 'loadend'
  | 'rendering'
  | 'loadstart'
  | 'progress'
  | 'error'

export type RenderRequestEvent<T extends RenderRequestEventTypes> = {
  type: T
  target: RenderRequest
} & (T extends 'error' ? Omit<ImgEvent<'error'>, 'target'> : unknown) &
  (T extends 'progress' ? Omit<ImgEvent<'progress'>, 'target'> : unknown) &
  (T extends 'loadstart' ? Omit<ImgEvent<'loadstart'>, 'target'> : unknown) &
  (T extends 'rendered' ? { url: string | null } : unknown)

export type RenderRequestEventHandler<T extends RenderRequestEventTypes> = (
  event: RenderRequestEvent<T>,
) => void

/** Strict event map for the RenderRequest (see Emitter) */
export type RenderRequestEventMap = {
  [K in RenderRequestEventTypes]: RenderRequestEvent<K>
}

/**
 * Represents a render request for an image at one size.
 *
 * Lifecycle: constructed → (image loads, size known) → queued on the
 * FrameQueue → `rendering` → renderer warms/uploads → `rendered`.
 * `clear()` deterministically releases listeners, queue slots and memory
 * accounting (invariant: no leaks across bucket churn).
 */
export class RenderRequest extends Logger<RenderRequestEventMap> {
  size: Size
  rendered = false
  image: Img
  bucket: Bucket
  bytesVideo = 0
  /**
   * Video bytes actually charged to the controller's video memory for this
   * request (0 when the texture was already resident). Used symmetrically on
   * removal so accounting never drifts.
   */
  bytesVideoCharged = 0
  readonly frameQueue: FrameQueue
  /** Scheduling priority — higher renders first (see setPriority) */
  #priority: number
  visible = false
  /** True if request is added to frame queue */
  requested = false
  cleared = false
  error: string | null = null

  /**
   * Constructs a new RenderRequest instance.
   */
  constructor({ size, bucket, priority, ...props }: RenderRequestProps) {
    super({ name: 'RenderRequest', logLevel: bucket.controller.level })
    this.size = size
    this.bucket = bucket
    this.#priority = priority ?? bucket.priority
    this.frameQueue = this.bucket.controller.frameQueue
    this.image = this.bucket.controller.getImage({ size, ...props })
    this.image.registerRequest(this)
    this.bucket.registerRequest(this)
    this.image.on('loadstart', this.#onloadStart)
    this.image.on('progress', this.#onProgress)
    this.image.on('error', this.#onImageError)
    this.on('error', this.#onError)

    if (!this.image.gotSize) {
      this.image.on('size', this.request)
    } else if (this.image.isDecoded(size)) {
      this.log.verbose(['Image already decoded', this.image.url])
      this.bytesVideo = this.image.getBytesVideo(this.size)
      this.rendered = true
      // microtask so subscribers attached right after construction still hear it
      microtask(this.#onRendered)
    } else {
      this.emit('progress')
      this.request()
    }
  }

  // a default handler
  #onError = (event: RenderRequestEvent<'error'>) => {
    this.log.error(['Image error', event.statusText, 'status', event.status])
    this.error = 'loadend error: ' + event.statusText
  }
  #onImageError = (event: ImgEvent<'error'>) => {
    this.emit('error', event)
  }
  #onProgress = (event: ImgEvent<'progress'>) => {
    this.emit('progress', event)
  }
  #onloadStart = (event: ImgEvent<'loadstart'>) => {
    this.emit('loadstart', event)
  }

  /** Scheduling priority — higher renders first */
  get priority(): number {
    return this.#priority
  }

  /** True while this request's bucket is paused — the frame queue skips it */
  get paused(): boolean {
    return this.bucket.paused
  }

  /**
   * Changes the scheduling priority on the fly (e.g. a virtual list slot
   * scrolled into or out of the focus area). Re-sorts the frame queue when
   * the request is still pending; already-rendered requests are unaffected.
   */
  setPriority(priority: number) {
    if (priority === this.#priority) return
    this.#priority = priority
    this.frameQueue.requeue(this)
  }

  /**
   * Queues the request on the frame queue (called once the image size is known).
   */
  request = () => {
    this.log.verbose(['Requesting render'])
    this.requested = true
    this.bytesVideo = this.image.getBytesVideo(this.size)
    this.emit('loadend')
    this.frameQueue.add(this)
  }

  /**
   * Clears the render request: releases listeners, frame-queue slot and
   * memory accounting. Deterministic teardown — safe to call repeatedly.
   */
  clear(force = false) {
    if (this.cleared) return
    if (!force && this.isLocked()) return
    this.cleared = true
    this.frameQueue.remove(this)
    this.image.off('size', this.request)
    this.image.off('loadstart', this.#onloadStart)
    this.image.off('progress', this.#onProgress)
    this.image.off('error', this.#onImageError)
    this.emit('clear')
    this.removeAllListeners()
  }

  /**
   * Checks if the render request is locked (not evictable).
   */
  isLocked() {
    return Boolean(
      !this.rendered ||
      this.visible ||
      this.bucket.locked ||
      this.image.isSizeLocked(this),
    )
  }

  /**
   * Renders the request via the injected renderer (or the default hidden-div
   * pre-warm). Called by the FrameQueue within its per-frame budget.
   */
  render() {
    if (this.cleared) return
    this.emit('rendering')

    if (this.image.isDecoded(this.size)) {
      // texture already resident — no warm needed
      this.#onRendered()
      return
    }

    const render = this.bucket.controller.renderer ?? defaultRenderer
    render({ target: this, done: this.#onRendered })
  }

  #onRendered = () => {
    if (this.cleared) {
      this.log.verbose([
        'Render completed after clear — ignored',
        this.image.url,
      ])
      return
    }

    if (this.rendered && this.requested) return // guard double done()
    this.rendered = true
    this.emit('rendered', { url: this.image.url })
  }

  /**
   * Emits an event, injecting `type` and `target`.
   * `on`/`off` are inherited fully-typed from the strict Emitter base.
   */
  emit<T extends RenderRequestEventTypes>(
    type: T,
    data?: Omit<RenderRequestEvent<T>, 'target' | 'type'>,
  ): boolean {
    return this.dispatch(type, {
      ...data,
      type,
      target: this,
    })
  }
}
