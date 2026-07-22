/**
 * GPU pre-warm renderer (strategy "B2": hidden-div warm).
 *
 * ############################################################################
 * # COBALT INVARIANT — DO NOT "OPTIMISE" THIS AWAY                          #
 * #                                                                          #
 * # On Cobalt (Chrome-88-class STB browser) a GPU texture upload happens     #
 * # ONLY for in-viewport, actually-painted pixels. Moving the warm element   #
 * # off-screen, using `display:none`, `visibility:hidden`, `opacity:0`, or   #
 * # a zero-size box silently breaks pre-warming — no error, no upload,       #
 * # nothing. That is why the warm div:                                       #
 * #   - lives in a fixed layer anchored INSIDE the viewport (top-left),      #
 * #   - uses `opacity: 0.001` (non-zero → painted, but invisible),           #
 * #   - has real width/height (the exact target render size),                #
 * #   - is `pointer-events: none` so it can never intercept input.           #
 * ############################################################################
 *
 * The div paints the image at the exact target size for two animation frames
 * (one to commit, one to paint/upload), then is removed and `done()` fires.
 *
 * An alternative strategy ("B1": staggered reveal of the real element) can be
 * injected by the consumer via `Controller({ renderer })` — the scheduler
 * calls the renderer once per request; the renderer decides how the on-screen
 * paint is produced and MUST call `done()` exactly once when finished.
 */
import { type RenderRequest } from '@lib/request/index.js'

/** Context handed to a renderer for a single warm/upload */
export type RenderContext = {
  /** The render request being warmed (size, image, bucket) */
  target: RenderRequest
  /** Must be called exactly once when the paint/upload had a chance to happen */
  done: () => void
}

/** Injectable render strategy. See module docs: B2 (default) vs B1 (reveal). */
export type Renderer = (context: RenderContext) => void

const nextFrame = (cb: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => cb())
  } else {
    setTimeout(cb, 16)
  }
}

let prewarmLayer: HTMLElement | null = null

/**
 * Single fixed container for all warm divs — in-viewport (top-left anchored),
 * zero own footprint, never intercepts input, hidden from a11y tree.
 */
const getPrewarmLayer = (): HTMLElement => {
  if (prewarmLayer && prewarmLayer.isConnected) {
    return prewarmLayer
  }

  const layer = document.createElement('div')
  layer.setAttribute('data-image-cache-pro', 'prewarm-layer')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '0',
    height: '0',
    overflow: 'visible', // children must stay paintable (see invariant above)
    pointerEvents: 'none',
  })
  document.body.appendChild(layer)
  prewarmLayer = layer
  return layer
}

/**
 * Default renderer: warms the GPU texture for `target` by painting a hidden
 * in-viewport div at the exact target size.
 *
 * Prefers the image's blob URL (already-loaded bytes) over the network URL so
 * the warm never triggers a second fetch.
 */
export const renderer: Renderer = ({ target, done }) => {
  /* c8 ignore next 4 — SSR/no-DOM guard */
  if (typeof document === 'undefined') {
    done()
    return
  }

  const url = target.image.element.src || target.image.url
  const div = document.createElement('div')
  Object.assign(div.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: `${target.size.width}px`,
    height: `${target.size.height}px`,
    // non-zero opacity → painted on Cobalt; visually imperceptible
    opacity: '0.001',
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'top left',
    // exact target size → the decoded texture matches the real render size
    backgroundSize: `${target.size.width}px ${target.size.height}px`,
    pointerEvents: 'none',
  })
  getPrewarmLayer().appendChild(div)

  // hold across two frames: frame 1 commits the div, frame 2 paints/uploads
  nextFrame(() => {
    nextFrame(() => {
      // parentNode.removeChild — Element.remove() is absent on Cobalt
      div.parentNode?.removeChild(div)
      done()
    })
  })
}
