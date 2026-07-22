/**
 * Microtask scheduling with a Promise fallback — `queueMicrotask` is not
 * guaranteed on Cobalt (Chrome-88-class STB browsers ship a Web API subset).
 * Either path is ~5 ms on-box; NEVER replace with setTimeout(0) (~41 ms).
 */
export const microtask: (cb: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : cb => {
        void Promise.resolve().then(cb)
      }
