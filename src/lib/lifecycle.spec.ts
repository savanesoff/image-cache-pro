/**
 * Integration suite over the real stack (Controller → Bucket →
 * RenderRequest → Img → Network/Loader → FrameQueue → renderer):
 *
 * - virtual-scroll lifecycle: on-the-go request additions to a live bucket,
 *   slot recycling (clear + re-request), accounting stays exact, zero leaks
 * - OOM behavior: RAM and video overflow → eviction of unlocked work,
 *   locked/visible work survives, overflow events only when nothing can be
 *   freed, and the engine keeps rendering afterwards (recovery)
 *
 * Deterministic: fake rAF, mocked XHR, synchronous injected renderer.
 */
import '@mocks/xhr'
import { Bucket } from '@lib/bucket'
import { Controller } from '@lib/controller'
import { type Img } from '@lib/image'
import { RenderRequest } from '@lib/request'
import { type Size } from '@utils'

const CARD: Size = { width: 10, height: 10 }
const CARD_BYTES = CARD.width * CARD.height * 3 // RGB
const COMPRESSED_BYTES = 24 // the mock PNG buffer below
const IMAGE_RAM = COMPRESSED_BYTES + CARD_BYTES

/** A valid 24-byte PNG header (signature + IHDR size) */
const pngBuffer = (): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(COMPRESSED_BYTES))
  view.setUint32(0, 0x89504e47)
  view.setUint32(4, 0x0d0a1a0a)
  view.setUint32(8, 13)
  view.setUint32(12, 0x49484452)
  view.setUint32(16, CARD.width)
  view.setUint32(20, CARD.height)
  return view.buffer
}

/** Deterministic rAF */
let frameCallbacks: (() => void)[] = []
const drainFrames = () => {
  let guard = 0

  while (frameCallbacks.length > 0 && guard++ < 1000) {
    const callbacks = frameCallbacks
    frameCallbacks = []
    callbacks.forEach(cb => cb())
  }
}

/** Completes every in-flight network load (XHR + bitmap decode) */
const pumpNetwork = (controller: Controller) => {
  let guard = 0

  while (controller.network.inFlight.size > 0 && guard++ < 1000) {
    for (const loader of Array.from(controller.network.inFlight.values())) {
      Object.defineProperty(loader.xhr, 'response', {
        value: pngBuffer(),
        configurable: true,
      })
      loader.xhr.onload?.(new ProgressEvent('load'))
      ;(loader as Img).element.onload?.(new Event('load'))
    }
  }
}

/** Load + warm everything that is pending */
const settle = (controller: Controller) => {
  pumpNetwork(controller)
  drainFrames()
}

const createController = ({ ram = 1e9, video = 1e9 } = {}) =>
  new Controller({
    ram,
    video,
    units: 'BYTE',
    renderer: ({ done }) => done(), // synchronous warm
    canRender: () => true,
  })

const createRequest = (bucket: Bucket, index: number) =>
  new RenderRequest({
    bucket,
    url: `https://cdn.example.com/poster-${index}.png`,
    size: CARD, // decoder bypass
  })

beforeEach(() => {
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number =>
    frameCallbacks.push(() => cb(0)),
  )
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
  globalThis.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('virtual-scroll lifecycle (one live bucket, rolling window)', () => {
  it('renders a window, recycles slots on the go, and keeps accounting exact', () => {
    const controller = createController()
    const bucket = new Bucket({ controller, name: 'virtual-list' })

    // initial window of 10 slots
    const requests = Array.from({ length: 10 }, (_, i) =>
      createRequest(bucket, i),
    )
    settle(controller)

    expect(requests.every(request => request.rendered)).toBe(true)
    expect(controller.video.getUsedSpace().bytes).toBe(10 * CARD_BYTES)
    expect(controller.ram.getUsedSpace().bytes).toBe(10 * IMAGE_RAM)

    // scroll: 5 slots leave the window, 5 new ones enter — same bucket
    for (let i = 0; i < 5; i++) {
      requests[i].clear()
      expect(requests[i].cleared).toBe(true)
    }

    const incoming = Array.from({ length: 5 }, (_, i) =>
      createRequest(bucket, 10 + i),
    )
    settle(controller)

    expect(incoming.every(request => request.rendered)).toBe(true)
    // 5 released + 5 charged → still exactly 10 cards of video memory
    expect(controller.video.getUsedSpace().bytes).toBe(10 * CARD_BYTES)
    // images stay cached in RAM until evicted (that is the cache working)
    expect(controller.ram.getUsedSpace().bytes).toBe(15 * IMAGE_RAM)
    expect(bucket.requests.size).toBe(10)

    // scroll back: a previously-cleared URL is re-requested — the image is
    // still cached (no network), only the warm re-runs
    const networkAdds = controller.network.inFlight.size
    const revisit = createRequest(bucket, 0)
    expect(controller.network.inFlight.size).toBe(networkAdds) // cache hit
    settle(controller)
    expect(revisit.rendered).toBe(true)
    expect(controller.video.getUsedSpace().bytes).toBe(11 * CARD_BYTES)

    // no re-request storms: everything is idle after settling
    expect(controller.frameQueue.size).toBe(0)
    expect(controller.network.inFlight.size).toBe(0)

    // teardown: deterministic, zero leaks
    controller.clear()
    expect(controller.ram.getUsedSpace().bytes).toBe(0)
    expect(controller.video.getUsedSpace().bytes).toBe(0)
    expect(controller.frameQueue.size).toBe(0)
    expect(controller.cache.size).toBe(0)
  })

  it('applies bucket priority changes to pending requests on the fly', () => {
    const controller = createController()
    const background = new Bucket({ controller, name: 'bg', priority: 0 })
    const focused = new Bucket({ controller, name: 'focus', priority: 0 })

    const backgroundRequests = Array.from({ length: 3 }, (_, i) =>
      createRequest(background, i),
    )
    const focusedRequests = Array.from({ length: 3 }, (_, i) =>
      createRequest(focused, 100 + i),
    )
    pumpNetwork(controller) // everything queued, nothing warmed yet

    // the user focuses the second rail before any frame fires
    focused.setPriority(10)

    const order: string[] = []
    backgroundRequests.forEach(request =>
      request.on('rendered', () => order.push('background')),
    )
    focusedRequests.forEach(request =>
      request.on('rendered', () => order.push('focused')),
    )

    drainFrames()
    expect(order.slice(0, 3)).toEqual(['focused', 'focused', 'focused'])
  })
})

describe('OOM: video memory pressure', () => {
  it('evicts unlocked warms to stay inside the budget (no overflow event)', () => {
    const controller = createController({ video: 3 * CARD_BYTES })
    const bucket = new Bucket({ controller, name: 'rail' })
    const overflowSpy = vi.fn()
    controller.on('video-overflow', overflowSpy)

    const requests = Array.from({ length: 3 }, (_, i) =>
      createRequest(bucket, i),
    )
    settle(controller)
    expect(controller.video.getUsedSpace().bytes).toBe(3 * CARD_BYTES)

    // 4th card: over budget → the oldest unlocked warm is evicted
    createRequest(bucket, 3)
    settle(controller)

    expect(requests[0].cleared).toBe(true)
    expect(controller.video.getUsedSpace().bytes).toBe(3 * CARD_BYTES)
    expect(overflowSpy).not.toHaveBeenCalled()
  })

  it('emits video-overflow when nothing can be freed, then recovers', () => {
    const controller = createController({ video: 2 * CARD_BYTES })
    const bucket = new Bucket({ controller, name: 'rail' })
    const overflowSpy = vi.fn()
    controller.on('video-overflow', overflowSpy)

    const first = createRequest(bucket, 0)
    const second = createRequest(bucket, 1)
    settle(controller)
    // everything on screen — locked
    first.visible = true
    second.visible = true

    const third = createRequest(bucket, 2)
    third.visible = true
    settle(controller)

    // nothing evictable → overflow reported, but the warm still happened
    expect(overflowSpy).toHaveBeenCalledTimes(1)
    expect(third.rendered).toBe(true)
    expect(controller.video.getUsedSpace().bytes).toBe(3 * CARD_BYTES)

    // recovery: a slot scrolls off screen and clears → pressure drops,
    // and new work renders without further overflow
    first.visible = false
    first.clear()
    expect(controller.video.getUsedSpace().bytes).toBe(2 * CARD_BYTES)

    const fourth = createRequest(bucket, 3)
    settle(controller)
    expect(fourth.rendered).toBe(true)
    expect(overflowSpy).toHaveBeenCalledTimes(1) // no new overflow
    expect(controller.video.getUsedSpace().bytes).toBe(2 * CARD_BYTES)
  })
})

describe('OOM: RAM pressure', () => {
  it('evicts the oldest unlocked image, then reloads it on demand (recovery)', () => {
    // budget fits exactly two images
    const controller = createController({ ram: 2 * IMAGE_RAM })
    const bucket = new Bucket({ controller, name: 'rail' })
    const overflowSpy = vi.fn()
    controller.on('ram-overflow', overflowSpy)
    const removedSpy = vi.fn()
    controller.on('image-removed', removedSpy)

    createRequest(bucket, 0)
    createRequest(bucket, 1)
    settle(controller)
    expect(controller.cache.size).toBe(2)
    expect(controller.ram.getUsedSpace().bytes).toBe(2 * IMAGE_RAM)

    // 3rd image overflows RAM → image-0 (oldest, unlocked) is evicted
    const third = createRequest(bucket, 2)
    settle(controller)

    expect(third.rendered).toBe(true)
    expect(controller.cache.size).toBe(2)
    expect(controller.cache.has('https://cdn.example.com/poster-0.png')).toBe(
      false,
    )
    expect(removedSpy).toHaveBeenCalledTimes(1)
    expect(overflowSpy).not.toHaveBeenCalled()
    expect(controller.ram.getUsedSpace().bytes).toBe(2 * IMAGE_RAM)

    // recovery: re-requesting the evicted URL reloads it from the network
    const revisit = createRequest(bucket, 0)
    settle(controller)
    expect(revisit.rendered).toBe(true)
    expect(controller.ram.getUsedSpace().bytes).toBe(2 * IMAGE_RAM)
  })

  it('emits ram-overflow when every image is locked (visible)', () => {
    const controller = createController({ ram: 1 * IMAGE_RAM })
    const bucket = new Bucket({ controller, name: 'rail' })
    const overflowSpy = vi.fn()
    controller.on('ram-overflow', overflowSpy)

    const first = createRequest(bucket, 0)
    settle(controller)
    first.visible = true // pinned on screen

    createRequest(bucket, 1)
    settle(controller)

    expect(overflowSpy).toHaveBeenCalled()
    // the pinned image survived the pressure
    expect(controller.cache.has('https://cdn.example.com/poster-0.png')).toBe(
      true,
    )
  })
})
