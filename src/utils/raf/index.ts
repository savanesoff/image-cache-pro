/**
 * Frame scheduling with a timeout fallback.
 *
 * `requestAnimationFrame` is the only primitive that aligns work with actual
 * frames on Cobalt (STB browsers): `setTimeout(0)` floors at ~41 ms there.
 * The fallback only exists for SSR / test environments without rAF.
 */
export const nextFrame = (cb: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => cb())
  } else {
    setTimeout(cb, 16)
  }
}
