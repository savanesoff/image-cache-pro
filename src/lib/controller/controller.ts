/**
 * The `Controller` class manages the loading and rendering of images.
 * It extends the `Logger` class, inheriting its logging capabilities.
 *
 * The `Controller` class maintains a cache of loaded images and a network queue for loading images.
 * It also manages the video memory, keeping track of the total bytes used.
 *
 * The `Controller` class provides methods to add an image to the cache and network queue (`addImage`),
 * add and remove video bytes of a render request (`#onRenderRequestRendered` and `#onRenderRequestRemoved`),
 * and add bytes to the video memory (`#addVideoBytes`).
 *
 * Usage:
 *
 * const controller = new Controller();
 * const image = new Img({ url: "http://example.com/image.jpg" });
 * controller.addImage(image); // Add an image to the cache and network queue
 */

import { FrameQueueProps, FrameQueue } from '@lib/frame-queue'
import { Img, ImgProps, ImgEvent } from '@lib/image'
import { LogLevel, Logger } from '@lib/logger'
import { Memory } from '@lib/memory'
import { Network } from '@lib/network'
import { RenderRequest, renderer } from '@lib/request'
import { UnitsType } from '@utils'
// import { FrameQueue, FrameQueueProps } from "@/frame-queue";

export type ControllerEventTypes =
  | 'ram-overflow'
  | 'video-overflow'
  | 'update'
  | 'image-added'
  | 'image-removed'
  | 'clear'
  | 'render-request-added'
  | 'render-request-removed'

/** Controller event */
export type ControllerEvent<T extends ControllerEventTypes> = {
  /** The type of the event */
  type: T
  /** The target of the event */
  target: Controller
} & (T extends 'ram-overflow' | 'video-overflow'
  ? { bytes: number }
  : unknown) &
  (T extends 'image-added' | 'image-removed' ? { image: Img } : unknown) &
  (T extends 'render-request-added' | 'render-request-removed'
    ? { request: RenderRequest }
    : unknown)

/** Controller event handler */
export type ControllerEventHandler<T extends ControllerEventTypes> = (
  event: ControllerEvent<T>,
) => void

export type ControllerProps = FrameQueueProps & {
  /** The amount of RAM [GB] */
  ram?: number
  /** The amount of video memory [GB] */
  video?: number
  /** The number of loaders in parallel */
  loaders?: number
  /** The units of the memory size, default "GB" */
  units?: UnitsType
  /** The log level for the controller */
  logLevel?: LogLevel
  /**
   * GPU memory allocation type.
   * True - full image size pixel data moves to GPU.
   * False - only the requested image size data moves to GPU.
   */
  gpuDataFull?: boolean
  /** The renderer function */
  renderer?: typeof renderer
}

const styles = {
  info: 'color: green;',
  warn: 'color: orange;',
  error: 'color: red;',
  log: 'color: skyblue;',
}

export type ControllerCache = Map<string, Img>

export class Controller extends Logger {
  readonly ram: Memory
  readonly video: Memory
  readonly cache: ControllerCache
  readonly frameQueue: FrameQueue
  readonly network: Network
  readonly units: UnitsType
  readonly gpuDataFull: boolean
  readonly renderer?: ControllerProps['renderer']

  constructor({
    ram = 2,
    video = 1,
    loaders = 6,
    units = 'GB',
    logLevel = 'error',
    hwRank = 1,
    gpuDataFull = false,
    renderer,
  }: ControllerProps) {
    super({
      name: 'Master',
      logLevel,
      styles,
    })
    this.units = units
    this.gpuDataFull = gpuDataFull
    this.renderer = renderer
    this.cache = new Map()
    this.frameQueue = new FrameQueue({
      logLevel,
      hwRank,
    })
    this.network = new Network({ loaders, logLevel })
    this.ram = new Memory({
      size: ram,
      units,
      logLevel,
      name: 'RAM',
    })
    this.video = new Memory({
      size: video,
      units,
      logLevel,
      name: 'VIDEO',
    })
  }

  //-------------------------------   API   ------------------------------------

  /**
   * Adds an image to the cache and network queue
   * If the image is already in the cache, it will not be added again
   * If image does not exist in the cache, it will be created and added to the network queue
   * @param image
   * @returns the image object
   */
  getImage(props: ImgProps): Img {
    return this.cache.get(props.url) || this.#createImage(props)
  }

  clear() {
    this.cache.forEach(image => image.clear())
    this.cache.clear()
    this.network.clear()
    this.ram.clear()
    this.video.clear()
    this.emit('clear')
    this.removeAllListeners()
  }

  //-------------------------------   PRIVATE   --------------------------------

  /**
   * Deletes an image from the cache
   * Calls the clear method of the image object
   * @param image
   */
  #deleteImage(image: Img) {
    this.cache.delete(image.url)
    this.ram.removeBytes(image.getBytesRam())
    image.clear()
    this.emit('image-removed', { image })
    this.emit('update')
  }

  /**
   * Creates a new image object and adds it to the cache
   * Image is added to the network to request loading immediately
   * Assigns event listeners to the image object to handle image loading and decoding
   * @param props
   * @returns
   */
  #createImage(props: ImgProps): Img {
    const image = new Img({
      ...props,
      gpuDataFull: this.gpuDataFull,
      logLevel: this.level,
    })
    this.cache.set(image.url, image) // TODO blob is network data, once we get image size any render of size will consume raw width/height data for ram
    image.on('loadend', this.#onImageLoadend)
    image.on('size', this.#onImageDecoded)
    image.on('render-request-rendered', this.#onRenderRequestRendered)
    image.on('render-request-removed', this.#onRenderRequestRemoved)
    image.on('render-request-added', this.#onRequestAdded)
    this.network.add(image) // request load immediately
    this.emit('image-added', { image })
    this.emit('update')
    return image
  }

  #onRequestAdded = (event: ImgEvent<'render-request-added'>) => {
    this.emit('render-request-added', { request: event.request })
    this.emit('update')
  }

  /**
   * Adds video bytes of a render request to the video memory
   * not in gpuDataFull mode not every render request will consume video memory
   * as a result, subsequent render request of the same image will have 0 bytes
   * @param event
   */
  #onRenderRequestRendered = ({
    bytes,
  }: ImgEvent<'render-request-rendered'>) => {
    this.#addVideoBytes(bytes)
  }

  /**
   * Removes video bytes of a render request from the video memory
   * @param event
   */
  #onRenderRequestRemoved = (event: ImgEvent<'render-request-removed'>) => {
    this.emit('render-request-removed', { request: event.request })
    this.video.removeBytes(event.bytes)
    this.emit('update')
  }

  //-----------------------   VIDEO MEMORY MANAGEMENT   -----------------------

  /**
   * Adds bytes to the video memory
   * If video memory is overflown, it will emit a "video-overfloaw" event
   * @param bytes
   */
  #addVideoBytes(bytes: number) {
    if (bytes <= 0) return
    const remainingBytes = this.video.addBytes(bytes)
    const overflow = remainingBytes < 0
    const overflowBytes = Math.abs(remainingBytes)

    if (overflow && this.#requestVideo(overflowBytes) === false) {
      this.emit('video-overflow', { bytes: overflowBytes })
    }
    this.emit('update')
  }

  /**
   * Requests video memory to free up bytes
   * Deletes unlocked render requests from the cache until enough bytes are freed
   * @param bytes
   * @returns true if enough bytes are freed, false otherwise
   */
  #requestVideo(bytes: number): boolean {
    let clearedBytes = 0
    // use FIFO to clear oldest render requests first
    const iterator = this.cache.values()
    let result = iterator.next()
    while (!result.done) {
      const image = result.value
      for (const request of image.renderRequests) {
        if (request.isLocked()) continue
        clearedBytes += request.bytesVideo
        request.clear()
        if (clearedBytes >= bytes) {
          return true
        }
      }
      result = iterator.next()
    }

    return false
  }

  //-----------------------   RAM MANAGEMENT   -----------------------

  /**
   * Adds image blob ram data to the ram
   * @param event
   */
  #onImageLoadend = ({ bytes }: ImgEvent<'loadend'>) => {
    this.#addRamBytes(bytes)
  }

  /**
   * Adds decoded image size ram data to the ram
   * @param event
   */
  #onImageDecoded = (event: ImgEvent<'size'>) => {
    this.#addRamBytes(event.target.getBytesVideo(event.size))
  }

  /**
   * Adds bytes to the ram
   * If ram is overflown, it will emit a "ram-overflow" event
   * @param bytes
   */
  #addRamBytes(bytes: number) {
    const remainingBytes = this.ram.addBytes(bytes)
    const overflow = remainingBytes < 0
    const overflowBytes = Math.abs(remainingBytes)

    if (overflow && this.#requestRam(overflowBytes) === false) {
      this.emit('ram-overflow', { bytes: overflowBytes })
    }

    this.emit('update')
  }

  /**
   * Requests ram to free up bytes
   * Deletes unlocked images from the cache until enough bytes are freed
   * This will result in all render requests of the image being cleared
   * @param bytes
   * @returns true if enough bytes are freed, false otherwise
   */
  #requestRam(bytes: number): boolean {
    let clearedBytes = 0
    const iterator = this.cache.values()
    let result = iterator.next()
    while (!result.done) {
      const image = result.value
      if (!image.isLocked()) {
        clearedBytes += image.getBytesRam()
        this.#deleteImage(image)
        if (clearedBytes >= bytes) {
          return true
        }
      }
      result = iterator.next()
    }
    return false
  }

  /**
   * Render requests stats for all images in the cache
   * @returns  total and rendered requests stats
   */
  getRequestsStats() {
    const data = {
      total: 0,
      rendered: 0,
    }

    Array.from(this.cache.values()).forEach(item => {
      data.total += item.renderRequests.size
      data.rendered += Array.from(item.renderRequests.values()).filter(
        request => request.rendered,
      ).length
    })

    return data
  }

  //------------------------------    EVENTS    ------------------------------
  /**
   * Adds an event listener to the controller
   * @param type
   * @param handler
   */
  on<T extends ControllerEventTypes>(
    type: T,
    handler: ControllerEventHandler<T>,
  ): this {
    return super.on(type, handler)
  }

  /**
   * Removes an event listener from the controller
   * @param type
   * @param handler
   */
  off<T extends ControllerEventTypes>(
    type: T,
    handler: ControllerEventHandler<T>,
  ): this {
    return super.off(type, handler)
  }

  /**
   * Emits an event of the specified type
   * @param type
   * @param props
   */
  emit<T extends ControllerEventTypes>(
    type: T,
    data?: Omit<ControllerEvent<T>, 'type' | 'target'>,
  ): boolean {
    return super.emit(type, {
      ...data,
      type,
      target: this,
    })
  }
}
