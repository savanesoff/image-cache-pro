import { type RenderRequest } from '@lib/request'
import { FrameQueue } from './frame-queue'

/**
 * Deterministic rAF: callbacks are captured and fired manually per "frame".
 */
let frameCallbacks: (() => void)[] = []

const tickFrame = () => {
  const callbacks = frameCallbacks
  frameCallbacks = []
  callbacks.forEach(cb => cb())
}

type FakeRequestProps = {
  priority?: number
  bytesUncompressed?: number
  decoded?: boolean
}

/** Minimal duck-typed RenderRequest — the queue only reads cost + priority */
const createRequest = ({
  priority = 0,
  bytesUncompressed = 1000,
  decoded = false,
}: FakeRequestProps = {}) => {
  const request = {
    priority,
    bytesVideo: bytesUncompressed,
    size: { width: 10, height: 10 },
    render: vi.fn(),
    image: {
      bytesUncompressed,
      isDecoded: () => decoded,
      url: 'test-url',
    },
  }
  return request as unknown as RenderRequest
}

beforeEach(() => {
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number =>
    frameCallbacks.push(() => cb(0)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FrameQueue', () => {
  describe('constructor', () => {
    it('should be defined with defaults', () => {
      const queue = new FrameQueue({})
      expect(queue).toBeDefined()
      expect(queue.hwRank).toBe(1)
      expect(queue.frameBudget).toEqual(FrameQueue.defaultBudget)
    })

    it('should clamp hwRank to [0, 1]', () => {
      expect(new FrameQueue({ hwRank: 2 }).hwRank).toBe(1)
      expect(new FrameQueue({ hwRank: -1 }).hwRank).toBe(0)
    })

    it('should accept a partial frame budget', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 5000 } })
      expect(queue.frameBudget.bytes).toBe(5000)
      expect(queue.frameBudget.ms).toBe(FrameQueue.defaultBudget.ms)
    })
  })

  describe('add', () => {
    it('should emit request-added', () => {
      const queue = new FrameQueue({})
      const spy = vi.fn()
      queue.on('request-added', spy)
      const request = createRequest()
      queue.add(request)
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'request-added', request }),
      )
    })

    it('should ignore duplicate adds', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.add(request)
      queue.add(request)
      expect(queue.size).toBe(1)
    })

    it('should not render synchronously', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.add(request)
      expect(request.render).not.toHaveBeenCalled()
    })

    it('should render on the next frame', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.add(request)
      tickFrame()
      expect(request.render).toHaveBeenCalledTimes(1)
      expect(queue.size).toBe(0)
    })
  })

  describe('remove', () => {
    it('should drop a pending request without rendering it', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.add(request)
      queue.remove(request)
      tickFrame()
      expect(request.render).not.toHaveBeenCalled()
      expect(queue.size).toBe(0)
    })
  })

  describe('per-frame budget', () => {
    it('should stop at the byte budget and continue next frame', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 1000, ms: 1000 } })
      const first = createRequest({ bytesUncompressed: 600 })
      const second = createRequest({ bytesUncompressed: 600 })
      queue.add(first)
      queue.add(second)

      tickFrame()
      expect(first.render).toHaveBeenCalledTimes(1)
      expect(second.render).not.toHaveBeenCalled()

      tickFrame()
      expect(second.render).toHaveBeenCalledTimes(1)
    })

    it('should always process at least one request per frame', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 10, ms: 1000 } })
      const huge = createRequest({ bytesUncompressed: 1_000_000 })
      queue.add(huge)
      tickFrame()
      expect(huge.render).toHaveBeenCalledTimes(1)
    })

    it('should treat decoded requests as zero-cost', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 1000, ms: 1000 } })
      const requests = Array.from({ length: 5 }, () =>
        createRequest({ bytesUncompressed: 5000, decoded: true }),
      )
      requests.forEach(request => queue.add(request))
      tickFrame()

      for (const request of requests) {
        expect(request.render).toHaveBeenCalledTimes(1)
      }
    })

    it('should scale the budget by hwRank', () => {
      const queue = new FrameQueue({
        hwRank: 0.5,
        frameBudget: { bytes: 1000, ms: 1000 },
      })
      // scaled budget = 500 bytes
      const first = createRequest({ bytesUncompressed: 300 })
      const second = createRequest({ bytesUncompressed: 300 })
      queue.add(first)
      queue.add(second)
      tickFrame()
      expect(first.render).toHaveBeenCalledTimes(1)
      expect(second.render).not.toHaveBeenCalled()
    })

    it('should emit processed with counts', () => {
      const queue = new FrameQueue({})
      const spy = vi.fn()
      queue.on('processed', spy)
      queue.add(createRequest())
      tickFrame()
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ processed: 1, pending: 0 }),
      )
    })
  })

  describe('priority', () => {
    it('should render higher priority first regardless of add order', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 1, ms: 1000 } })
      const low = createRequest({ priority: 0, bytesUncompressed: 100 })
      const high = createRequest({ priority: 10, bytesUncompressed: 100 })
      queue.add(low)
      queue.add(high)

      tickFrame()
      expect(high.render).toHaveBeenCalledTimes(1)
      expect(low.render).not.toHaveBeenCalled()

      tickFrame()
      expect(low.render).toHaveBeenCalledTimes(1)
    })

    it('should keep FIFO order within the same priority', () => {
      const queue = new FrameQueue({ frameBudget: { bytes: 1, ms: 1000 } })
      const order: string[] = []
      const first = createRequest({ bytesUncompressed: 100 })
      const second = createRequest({ bytesUncompressed: 100 })
      vi.mocked(first.render).mockImplementation(() => {
        order.push('first')
      })
      vi.mocked(second.render).mockImplementation(() => {
        order.push('second')
      })
      queue.add(first)
      queue.add(second)
      tickFrame()
      tickFrame()
      expect(order).toEqual(['first', 'second'])
    })
  })

  describe('canRender gate (input yield)', () => {
    it('should idle while the gate is closed and resume when open', () => {
      let busy = true
      const queue = new FrameQueue({ canRender: () => !busy })
      const request = createRequest()
      queue.add(request)

      tickFrame()
      expect(request.render).not.toHaveBeenCalled()

      tickFrame()
      expect(request.render).not.toHaveBeenCalled()

      busy = false
      tickFrame()
      expect(request.render).toHaveBeenCalledTimes(1)
    })
  })

  describe('pause / resume', () => {
    it('should not process while paused', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.pause()
      queue.add(request)
      tickFrame()
      expect(request.render).not.toHaveBeenCalled()
      expect(queue.paused).toBe(true)
    })

    it('should resume processing on the next frame', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.pause()
      queue.add(request)
      tickFrame()
      queue.resume()
      tickFrame()
      expect(request.render).toHaveBeenCalledTimes(1)
    })

    it('should emit pause and resume events', () => {
      const queue = new FrameQueue({})
      const pauseSpy = vi.fn()
      const resumeSpy = vi.fn()
      queue.on('pause', pauseSpy)
      queue.on('resume', resumeSpy)
      queue.pause()
      queue.resume()
      expect(pauseSpy).toHaveBeenCalledTimes(1)
      expect(resumeSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('clear', () => {
    it('should drop all pending requests', () => {
      const queue = new FrameQueue({})
      const request = createRequest()
      queue.add(request)
      queue.clear()
      tickFrame()
      expect(request.render).not.toHaveBeenCalled()
      expect(queue.size).toBe(0)
    })
  })
})
