import { type RenderRequest } from '@lib/request'
import { renderer } from './renderer'

/** Deterministic rAF: callbacks captured, fired manually per frame */
let frameCallbacks: (() => void)[] = []

const tickFrame = () => {
  const callbacks = frameCallbacks
  frameCallbacks = []
  callbacks.forEach(cb => cb())
}

const createRequest = ({ elementSrc = '' } = {}) => {
  return {
    size: { width: 320, height: 180 },
    image: {
      url: 'https://example.com/image.jpg',
      element: { src: elementSrc },
    },
  } as unknown as RenderRequest
}

const layerSelector = '[data-image-cache-pro="prewarm-layer"]'

beforeEach(() => {
  frameCallbacks = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number =>
    frameCallbacks.push(() => cb(0)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document
    .querySelector(layerSelector)
    ?.parentNode?.removeChild(document.querySelector(layerSelector) as Node)
})

describe('renderer (default B2 hidden-div pre-warm)', () => {
  it('should create a single fixed in-viewport prewarm layer', () => {
    renderer({ target: createRequest(), done: vi.fn() })
    renderer({ target: createRequest(), done: vi.fn() })

    const layers = document.querySelectorAll(layerSelector)
    expect(layers).toHaveLength(1)
    const layer = layers[0] as HTMLElement
    expect(layer.style.position).toBe('fixed')
    expect(layer.style.top).toBe('0px')
    expect(layer.style.left).toBe('0px')
    expect(layer.style.pointerEvents).toBe('none')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
  })

  it('should paint the warm div at the exact target size with non-zero opacity', () => {
    renderer({ target: createRequest(), done: vi.fn() })
    const div = document.querySelector(layerSelector)
      ?.firstElementChild as HTMLElement
    expect(div.style.width).toBe('320px')
    expect(div.style.height).toBe('180px')
    expect(div.style.backgroundSize).toBe('320px 180px')
    // COBALT INVARIANT: opacity must be non-zero or the paint is skipped
    expect(Number(div.style.opacity)).toBeGreaterThan(0)
    expect(div.style.pointerEvents).toBe('none')
  })

  it('should prefer the blob URL over the network URL', () => {
    renderer({
      target: createRequest({ elementSrc: 'blob:mock-blob-url' }),
      done: vi.fn(),
    })
    const div = document.querySelector(layerSelector)
      ?.firstElementChild as HTMLElement
    expect(div.style.backgroundImage).toContain('blob:mock-blob-url')
  })

  it('should fall back to the network URL when no blob exists', () => {
    renderer({ target: createRequest(), done: vi.fn() })
    const div = document.querySelector(layerSelector)
      ?.firstElementChild as HTMLElement
    expect(div.style.backgroundImage).toContain('https://example.com/image.jpg')
  })

  it('should hold the div for two frames, then remove it and call done', () => {
    const done = vi.fn()
    renderer({ target: createRequest(), done })
    const layer = document.querySelector(layerSelector) as HTMLElement

    expect(layer.childElementCount).toBe(1)
    tickFrame() // frame 1: committed
    expect(layer.childElementCount).toBe(1)
    expect(done).not.toHaveBeenCalled()

    tickFrame() // frame 2: painted/uploaded
    expect(layer.childElementCount).toBe(0)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('should warm multiple requests concurrently in the same layer', () => {
    const doneA = vi.fn()
    const doneB = vi.fn()
    renderer({ target: createRequest(), done: doneA })
    renderer({ target: createRequest(), done: doneB })
    const layer = document.querySelector(layerSelector) as HTMLElement
    expect(layer.childElementCount).toBe(2)

    tickFrame()
    tickFrame()
    expect(layer.childElementCount).toBe(0)
    expect(doneA).toHaveBeenCalledTimes(1)
    expect(doneB).toHaveBeenCalledTimes(1)
  })

  it('should recreate the layer if it was detached (e.g. body was replaced)', () => {
    renderer({ target: createRequest(), done: vi.fn() })
    const first = document.querySelector(layerSelector) as HTMLElement
    first.parentNode?.removeChild(first)

    renderer({ target: createRequest(), done: vi.fn() })
    expect(document.querySelectorAll(layerSelector)).toHaveLength(1)
  })
})
