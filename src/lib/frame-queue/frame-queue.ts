/**
 * The `FrameQueue` class provides a queue that processes RenderRequests,
 * by rendering each image separately.
 * It extends the `Logger` class, inheriting its logging capabilities.
 *
 * The `FrameQueue` class maintains a queue of `RenderRequest` instances,
 * each representing a request to render an image.
 * It also maintains a `hwRank` property, which represents the hardware rank number between 0 and 1,
 * where 1 is the fastest.
 *
 * The `FrameQueue` class provides an `add` method to add a `RenderRequest` to the queue.
 *
 * Usage:
 *
 * const frameQueue = new FrameQueue({
 *   name: "My Frame Queue",
 *   logLevel: "verbose",
 *   hwRank: 0.8,
 *   renderer: (props) => {
 *     console.log(`Rendering frame for request ${props.request.id} with render time ${props.renderTime}`);
 *   },
 * });
 * const renderRequest = new RenderRequest({ id: "request1", priority: 1 });
 * frameQueue.add(renderRequest); // Add a render request to the queue
 */
import { Logger, LoggerProps } from '@lib/logger'
import { RenderRequest } from '@lib/request'

export type FrameQueueEventTypes = 'rendered' | 'request-added' | 'processed'
/** FrameQueue event */
export type FrameQueueEvent<T extends FrameQueueEventTypes> = {
  /** The type of the event */
  type: T
  /** The target of the event */
  target: FrameQueue
} & (T extends 'request-added' ? { request: RenderRequest } : unknown)
/** FrameQueue event handler */
export type FrameQueueEventHandler<T extends FrameQueueEventTypes> = (
  event: FrameQueueEvent<T>,
) => void

export type RendererProps = {
  /** The estimated render time for the request depending on the image size and HW rank */
  renderTime: number
}

/** Render function */
export type RenderFunction = (props: RendererProps) => void

/** FrameQueue properties */
export type FrameQueueProps = LoggerProps & {
  /** The hardware rank number between 0 and 1, where 1 is the fastest */
  hwRank?: number
}

/**
 * FrameQueue is a queue that processes callbacks in the next animation frame.
 */
export class FrameQueue extends Logger {
  /** Flag to indicate if the queue is scheduled */
  private scheduled = false
  /** Hardware rank number between 0 and 1, where 1 is the fastest */
  readonly hwRank: number
  /** Set of render requests */
  readonly queue = new Set<RenderRequest>()
  /**
   * The number of bytes per frame ratio estimate.
   * This value determines how fast a platform can render a frame based on
   * the number of bytes in the image.
   * Where bytes refers to the uncompressed image size.
   * and can be adjusted based on the platform's performance.
   */
  static readonly bytesPerFrameRatio = 500

  constructor({
    name = 'Frame queue',
    logLevel = 'verbose',
    hwRank = 1,
  }: FrameQueueProps) {
    super({
      name,
      logLevel,
    })
    this.hwRank = hwRank
    this.log.info([`hwRank: ${this.hwRank}`])
  }

  /**
   * Adds a render request to the queue.
   * @param request
   */
  add(request: RenderRequest) {
    this.queue.add(request)
    this.emit('request-added', { request })
    this.log.info([`added: ${this.queue.size}`])
    this.#next()
  }

  //------------------------   PRIVATE METHODS   -------------------------------

  /**
   * Gets the render time for a request based on the image size and hardware rank.
   * @param request
   */
  #getRenderTime(request: RenderRequest) {
    const time = request.image.isDecoded(request.size)
      ? 0
      : (request.image.bytesUncompressed / FrameQueue.bytesPerFrameRatio) *
        (1 - this.hwRank)
    return time
  }

  /**
   * Processes the next render request in the queue.
   * Waits for the current request to be processed before processing the next one.
   */
  #next() {
    if (this.scheduled) return
    this.scheduled = true
    // get the request in the order they were added
    const request = this.queue.values().next().value as
      | RenderRequest
      | undefined
    if (!request) {
      this.scheduled = false
      return
    }

    const renderTime = this.#getRenderTime(request)

    this.log.info([
      `processing: ${this.queue.size}`,
      `renderTime: ${renderTime}`,
    ])
    this.queue.delete(request)
    request.render({ renderTime })

    setTimeout(() => {
      this.scheduled = false
      this.#next()
      this.log.verbose([
        'processed request',
        request.image.url,
        `queue size: ${this.queue.size}`,
      ])
    }, renderTime)
  }

  //------------------------   EVENT EMITTER METHODS   -------------------------

  /**
   * Adds an event listener for the specified event type.
   * @param type - The type of the event to listen for.
   * @param handler - The event handler function.
   * @returns The current instance of the FrameQueue class.
   */
  on<T extends FrameQueueEventTypes>(
    type: T,
    handler: FrameQueueEventHandler<T>,
  ): this {
    return super.on(type, handler)
  }

  /**
   * Removes an event listener for the specified event type.
   * @param type - The type of the event to remove the listener for.
   * @param handler - The event handler function to remove.
   * @returns The current instance of the FrameQueue class.
   */
  off<T extends FrameQueueEventTypes>(
    type: T,
    handler: FrameQueueEventHandler<T>,
  ): this {
    return super.off(type, handler)
  }

  /**
   * Emits an event of the specified type with the specified data.
   * @param type - The type of the event to emit.
   * @param data - The data to emit with the event.
   * @returns True if the event was emitted successfully, false otherwise.
   */
  emit<T extends FrameQueueEventTypes>(
    type: T,
    data?: Omit<FrameQueueEvent<T>, 'target' | 'type'>,
  ): boolean {
    return super.emit(type, { ...data, type, target: this })
  }
}
