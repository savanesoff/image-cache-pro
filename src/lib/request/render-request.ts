/**
 * Module for rendering requests.
 * Each request is associated with an image and a bucket. Where an image can
 * have multiple requests associated with it, a bucket can have multiple images
 */
import { Bucket } from '@lib/bucket'
import { RendererProps, FrameQueue } from '@lib/frame-queue'
import { ImgProps, ImgEvent, Img } from '@lib/image'
import { Logger } from '@lib/logger'
import { Size } from '@utils'
import { renderer } from './renderer'

export type RenderRequestProps = ImgProps & {
  size: Size
  bucket: Bucket
}

export type RenderRequestEventTypes =
  | 'rendered'
  | 'clear'
  | 'loadend'
  | 'rendering'
  | 'loadstart'
  | 'progress'
  | 'error'
  | 'render'

export type RenderRequestEvent<T extends RenderRequestEventTypes> = {
  type: T
  target: RenderRequest
} & (T extends 'error' ? Omit<ImgEvent<'error'>, 'target'> : unknown) &
  (T extends 'progress' ? Omit<ImgEvent<'progress'>, 'target'> : unknown) &
  (T extends 'render' | 'rendering' ? { renderTime: number } : unknown) &
  (T extends 'loadstart' ? Omit<ImgEvent<'loadstart'>, 'target'> : unknown) &
  (T extends 'rendered' ? { url: string | null } : unknown)

export type RenderRequestEventHandler<T extends RenderRequestEventTypes> = (
  event: RenderRequestEvent<T>,
) => void

/**
 * Represents a render request for an image.
 */
export class RenderRequest extends Logger {
  size: Size
  rendered = false
  image: Img
  bucket: Bucket
  bytesVideo = 0
  readonly frameQueue: FrameQueue
  visible = false
  /** True if request is added to frame queue */
  requested = false
  cleared = false
  #renderTimeout: ReturnType<typeof setTimeout> | null = null
  error: string | null = null
  /**
   * Constructs a new RenderRequest instance.
   * @param size - The size of the image.
   * @param bucket - The bucket containing the image.
   * @param props - Additional properties for the request.
   */
  constructor({ size, bucket, ...props }: RenderRequestProps) {
    super({ name: 'RenderRequest', logLevel: bucket.controller.level })
    this.size = size
    this.bucket = bucket
    this.frameQueue = this.bucket.controller.frameQueue
    this.image = this.bucket.controller.getImage(props)
    this.image.registerRequest(this)
    this.bucket.registerRequest(this)
    this.image.on('loadstart', this.#onloadStart)
    this.image.on('progress', this.#onProgress)
    this.image.on('error', this.#onImageError)
    // this.image.on('loadend', this.#onLoadEnd)
    this.on('error', this.#onError)

    if (!this.image.loaded) {
      this.image.on('size', this.request)
    } else if (this.image.isDecoded(size)) {
      this.log.verbose(['Image already decoded', this.image.url])
      this.bytesVideo = this.image.getBytesVideo(this.size)
      this.rendered = true
      setTimeout(this.#onRendered, 0)
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
  #onLoadEnd = (event: ImgEvent<'loadend'>) => {
    this.emit('loadend', event)
  }

  /**
   * Requests the image to be rendered.
   */
  request = () => {
    this.log.verbose(['Requesting render'])
    this.requested = true
    this.bytesVideo = this.image.getBytesVideo(this.size)
    // request render
    this.emit('loadend')
    this.frameQueue.add(this)
  }

  /**
   * Clears the render request.
   */
  clear(force = false) {
    if (!force && this.isLocked()) return
    this.image.off('size', this.request)
    this.image.off('loadstart', this.#onloadStart)
    this.image.off('progress', this.#onProgress)
    this.image.off('error', this.#onImageError)
    this.image.off('loadend', this.#onLoadEnd)
    this.emit('clear')
    if (this.#renderTimeout) {
      clearTimeout(this.#renderTimeout)
    }
    this.cleared = true
    this.removeAllListeners()
  }

  /**
   * Checks if the render request is locked.
   * @returns True if the render request is locked, false otherwise.
   */
  isLocked() {
    return (
      !this.rendered ||
      this.visible ||
      this.bucket.locked ||
      this.image.isSizeLocked(this)
    )
  }

  /**
   * The default render function.
   * @param props
   */
  render({ renderTime }: RendererProps) {
    this.emit('rendering', { renderTime })
    // render time of 0 means the image is already rendered
    const isRendered = renderTime === 0
    // if renderer provided, call it
    if (!isRendered && this.bucket.controller.renderer) {
      this.bucket.controller.renderer({
        target: this,
        renderTime,
        type: 'render',
      })
    } else if (!isRendered && this.emit('render', { renderTime }) !== true) {
      renderer({ target: this, renderTime, type: 'render' })
    }

    this.#renderTimeout = setTimeout(this.#onRendered, renderTime)
  }

  #onRendered = () => {
    this.rendered = true
    if (this.cleared) {
      this.log.error(['Rendered cleared request', this.image.url])
    }
    this.emit('rendered', { url: this.image.url })
  }

  /**
   * Adds an event listener for the specified event type.
   * @param type - The type of the event.
   * @param handler - The event handler function.
   * @returns The current instance of RenderRequest.
   */
  on<T extends RenderRequestEventTypes>(
    type: T,
    handler: RenderRequestEventHandler<T>,
  ): this {
    return super.on(type, handler)
  }

  /**
   * Removes an event listener for the specified event type.
   * @param type - The type of the event.
   * @param handler - The event handler function.
   * @returns The current instance of RenderRequest.
   */
  off<T extends RenderRequestEventTypes>(
    type: T,
    handler: RenderRequestEventHandler<T>,
  ): this {
    return super.off(type, handler)
  }

  /**
   * Emits an event of the specified type.
   * @param type - The type of the event.
   * @param data - Additional data for the event.
   * @returns True if the event was emitted successfully, false otherwise.
   */
  emit<T extends RenderRequestEventTypes>(
    type: T,
    data?: Omit<RenderRequestEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(type, {
      ...data,
      type,
      target: this,
    })
  }
}
