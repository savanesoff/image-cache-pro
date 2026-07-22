/**
 * The `FrameQueue` serialises GPU texture-upload work ("warms") so the
 * hardware processes a bounded amount of image data per animation frame,
 * off the interaction critical path.
 *
 * ## Why rAF and not setTimeout (Cobalt scheduling reality)
 *
 * Measured on-box (Cobalt, Chrome-88-class STB browser):
 * - `setTimeout(0)` floors at ~41 ms → a setTimeout-paced queue maxes out at
 *   ~24 warms/sec and cannot express "N per frame".
 * - `requestAnimationFrame` fires on the next vsync (~16 ms @60 Hz) — the only
 *   primitive that aligns work with actual frames.
 * - `MessageChannel` is absent; `queueMicrotask` is polyfilled (~5 ms).
 *
 * The queue therefore drains on rAF ticks with a configurable per-frame
 * budget (uncompressed bytes and/or ms), scaled by `hwRank`.
 *
 * ## Yielding to input
 *
 * Warming is background work and must never jank navigation. The consumer
 * wires `canRender` to its input/animation state (e.g. "no key held, no
 * scroll animation in flight"). While the gate returns false (or the queue is
 * `pause()`d) the queue idles, re-checking once per frame.
 *
 * ## Priority
 *
 * Requests are drained highest-priority-first (FIFO within the same
 * priority). A newly-focused rail with a higher priority therefore jumps the
 * queue on the very next frame — no explicit preemption call needed.
 */
import { Logger, type LoggerProps } from '@lib/logger'
import { type RenderRequest } from '@lib/request'
import { nextFrame } from '@utils'

export type FrameQueueEventTypes =
  'request-added' | 'request-removed' | 'processed' | 'pause' | 'resume'

/** FrameQueue event */
export type FrameQueueEvent<T extends FrameQueueEventTypes> = {
  /** The type of the event */
  type: T
  /** The target of the event */
  target: FrameQueue
} & (T extends 'request-added' | 'request-removed'
  ? { request: RenderRequest }
  : unknown) &
  (T extends 'processed' ? { processed: number; pending: number } : unknown)

/** FrameQueue event handler */
export type FrameQueueEventHandler<T extends FrameQueueEventTypes> = (
  event: FrameQueueEvent<T>,
) => void

/** Strict event map for the FrameQueue (see Emitter) */
export type FrameQueueEventMap = {
  [K in FrameQueueEventTypes]: FrameQueueEvent<K>
}

/** Per-frame work budget. Both limits apply; at least one request is always processed per frame. */
export type FrameBudget = {
  /** Max estimated uncompressed bytes handed to the GPU per frame */
  bytes: number
  /** Max ms the queue spends dispatching per frame (guard rail) */
  ms: number
}

/** Gate the consumer wires to input/platform state. Return false to pause warming for the frame. */
export type CanRenderPredicate = () => boolean

/** FrameQueue properties */
export type FrameQueueProps = LoggerProps & {
  /**
   * The hardware rank number between 0 and 1, where 1 is the fastest.
   * Scales the per-frame budget (NOT a sleep multiplier).
   */
  hwRank?: number
  /** Per-frame budget overrides */
  frameBudget?: Partial<FrameBudget>
  /** Input-yield gate: return false while the app is busy (key held, scroll animating) */
  canRender?: CanRenderPredicate
}

const nowMs = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

/**
 * FrameQueue drains render requests on animation frames within a byte/ms budget.
 */
export class FrameQueue extends Logger<FrameQueueEventMap> {
  /** Hardware rank number between 0 and 1, where 1 is the fastest. Scales the budget. */
  readonly hwRank: number
  /** Base per-frame budget (before hwRank scaling) */
  readonly frameBudget: FrameBudget
  /** Input-yield gate; reassignable at runtime */
  canRender: CanRenderPredicate
  /** True while a frame callback is scheduled */
  #scheduled = false
  /** True while pause()d */
  #paused = false
  /** Pending requests, highest priority first, FIFO within equal priority */
  readonly #queue: RenderRequest[] = []
  /** O(1) membership for add/remove/requeue (the array stays the order source) */
  readonly #queued = new Set<RenderRequest>()
  /** Default budget: ~1 MB uncompressed (≈ one 512×512 RGBA texture) and 8 ms per frame */
  static readonly defaultBudget: FrameBudget = {
    bytes: 1_048_576,
    ms: 8,
  }

  constructor({
    name = 'Frame queue',
    logLevel = 'error',
    hwRank = 1,
    frameBudget,
    canRender,
  }: FrameQueueProps) {
    super({
      name,
      logLevel,
    })
    this.hwRank = Math.min(1, Math.max(0, hwRank))
    this.frameBudget = { ...FrameQueue.defaultBudget, ...frameBudget }
    this.canRender = canRender ?? (() => true)
  }

  /** Number of pending requests */
  get size(): number {
    return this.#queue.length
  }

  /** True while pause()d */
  get paused(): boolean {
    return this.#paused
  }

  /**
   * Adds a render request to the queue (sorted by priority, FIFO within equal priority).
   */
  add(request: RenderRequest) {
    if (this.#queued.has(request)) {
      return
    }

    this.#queued.add(request)
    this.#insertSorted(request)
    this.emit('request-added', { request })
    this.#schedule()
  }

  /**
   * Removes a pending request from the queue (e.g. on request clear).
   */
  remove(request: RenderRequest) {
    if (!this.#queued.delete(request)) {
      return
    }

    this.#queue.splice(this.#queue.indexOf(request), 1)
    this.emit('request-removed', { request })
  }

  /**
   * Re-sorts a pending request after its priority changed (no events).
   * No-op when the request is not queued — a rendered request keeps its
   * result; only future scheduling is affected by priority changes.
   */
  requeue(request: RenderRequest) {
    if (!this.#queued.has(request)) {
      return
    }

    this.#queue.splice(this.#queue.indexOf(request), 1)
    this.#insertSorted(request)
  }

  /** Halts processing. Queued requests are retained. */
  pause() {
    if (this.#paused) return
    this.#paused = true
    this.emit('pause')
  }

  /** Resumes processing on the next frame. */
  resume() {
    if (!this.#paused) return
    this.#paused = false
    this.emit('resume')
    this.#schedule()
  }

  /** Clears all pending requests without rendering them. */
  clear() {
    this.#queue.length = 0
    this.#queued.clear()
  }

  //------------------------   PRIVATE METHODS   -------------------------------

  /** Inserts before the first lower-priority entry (stable within equal priority) */
  #insertSorted(request: RenderRequest) {
    const index = this.#queue.findIndex(
      queued => queued.priority < request.priority,
    )

    if (index === -1) {
      this.#queue.push(request)
    } else {
      this.#queue.splice(index, 0, request)
    }
  }

  #schedule() {
    if (this.#scheduled || this.#queue.length === 0) return
    this.#scheduled = true
    nextFrame(this.#onFrame)
  }

  /**
   * Estimated GPU upload cost of a request in uncompressed bytes.
   * Already-decoded sizes cost ~0 (texture cache hit).
   */
  #getCost(request: RenderRequest): number {
    return request.image.isDecoded(request.size)
      ? 0
      : request.image.bytesUncompressed || request.bytesVideo
  }

  #onFrame = () => {
    this.#scheduled = false

    if (this.#queue.length === 0) {
      return
    }

    if (this.#paused) {
      // stay idle until resume() reschedules
      return
    }

    if (!this.canRender()) {
      // input-yield: idle-poll once per frame while the app is busy
      this.#schedule()
      return
    }

    const scale = Math.max(0.1, this.hwRank)
    const byteBudget = this.frameBudget.bytes * scale
    const msBudget = this.frameBudget.ms * scale
    const start = nowMs()
    let spentBytes = 0
    let processed = 0

    while (this.#queue.length > 0) {
      const request = this.#queue[0]
      const cost = this.#getCost(request)

      // always process at least one request per frame to guarantee progress
      if (processed > 0 && spentBytes + cost > byteBudget) break
      if (processed > 0 && nowMs() - start > msBudget) break

      this.#queue.shift()
      this.#queued.delete(request)
      spentBytes += cost
      processed++
      request.render()
    }

    this.log.verbose([
      `processed: ${processed}`,
      `bytes: ${spentBytes}`,
      `pending: ${this.#queue.length}`,
    ])
    this.emit('processed', { processed, pending: this.#queue.length })
    this.#schedule()
  }

  //------------------------   EVENT EMITTER METHODS   -------------------------

  /**
   * Emits an event, injecting `type` and `target`.
   * `on`/`off` are inherited fully-typed from the strict Emitter base.
   */
  emit<T extends FrameQueueEventTypes>(
    type: T,
    data?: Omit<FrameQueueEvent<T>, 'target' | 'type'>,
  ): boolean {
    return this.dispatch(type, {
      ...data,
      type,
      target: this,
    })
  }
}
