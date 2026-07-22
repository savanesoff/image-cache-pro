# image-cache-pro

## 0.7.0

### Minor Changes

- 069e8c4: Production-grade refactor, Pass 1 (Cobalt-correct scheduling):

  - **Pacing rewrite**: `FrameQueue` is now `requestAnimationFrame`-driven with a
    configurable per-frame budget (`frameBudget: { bytes, ms }`), scaled by
    `hwRank`. Replaces `setTimeout`-sleep pacing (Cobalt floors `setTimeout(0)`
    at ~41 ms).
  - **Input-yield gate**: `Controller({ canRender })` + `controller.pause()` /
    `resume()` — warming halts while the app is busy and resumes on idle.
  - **Priority lanes**: `Bucket({ priority })` / `RenderRequest({ priority })` —
    higher priority renders first; a newly-focused rail jumps the queue on the
    next frame.
  - **Decoder bypass**: providing `size` skips the header decoders entirely; the
    decoder suite is now lazily imported (split out of the main bundle).
  - **Renderer formalised**: injectable `Renderer` strategy
    (`Controller({ renderer })`). The default B2 hidden-div pre-warm now uses a
    single fixed in-viewport layer, prefers the blob URL over the network URL,
    and documents the Cobalt paint invariant loudly.
  - **Strict typed events**: new zero-dependency `Emitter` with strict event
    maps end to end; the `events` and `tslib` runtime dependencies are gone.
  - **Teardown & accounting fixes**: blob URLs are actually revoked (previously
    leaked), in-flight XHRs abort on clear, cleared requests leave the frame
    queue, video-memory charges are tracked per texture so multi-request images
    no longer drift the accounting negative, and RAM accounting is symmetric.

  Breaking (pre-1.0 minor): `renderTime`/`render` event removed from
  `RenderRequest` (renderers now call `done()`); `FrameQueueProps.hwRank` is a
  budget scalar; `Network` event payloads are `{ type, target, loader }`.

- f2f7563: Production-hardening pass (Pass 2): versatility, resilience, packaging.

  - **Runtime control**: `controller.canRender` is a get/set accessor (the
    library never attaches input listeners — the consumer's input layer owns
    the gate, trivially wireable from a React hook), and budgets are live:
    `setRamBudget()` / `setVideoBudget()` (backed by `Memory.setSize()`)
    evict immediately on shrink and emit overflow only when nothing can be
    freed.
  - **Per-bucket control**: `bucket.pause()`/`resume()` gates warming for one
    bucket without blocking others (skipped in the frame queue, woken on
    resume), and an optional per-bucket GPU cap (`videoBudget` +
    `setVideoBudget()`) self-evicts the bucket's oldest unlocked warms.
  - **Live priorities**: `RenderRequest.setPriority()` and `Bucket.setPriority()`
    re-sort pending work in the frame queue on the fly — focused rails jump the
    queue; virtual lists churn requests through one long-lived bucket.
  - **Loader resilience**: hard XHR timeout (`timeoutMs`, default 30s) and
    linear retry backoff (`retryDelayMs`, default 250ms); aborting a loader
    waiting on its backoff timer emits `abort` and releases its network slot.
  - **Optimizations**: O(1) frame-queue membership, refcounted per-bucket image
    tracking (progress/stats no longer allocate per event), numeric log gates.
  - **Robustness**: JPEG header decoder is bounds-checked (no RangeError or
    infinite loop on truncated/corrupt data).
  - **Packaging**: CJS build ships as `.cjs` (the package is `type: module`),
    publint-verified exports.
  - **Module layout**: renderer moved to its own module (`@lib/renderer`);
    shared `nextFrame`/`microtask` utils.
  - **Tests**: 339 unit tests incl. new integration suites — virtual-scroll
    lifecycle with exact accounting + zero-leak teardown, and OOM suites for
    RAM/video pressure: eviction order, locked-work survival, overflow events
    and post-pressure recovery.

## 0.6.0

### Minor Changes

- 1c44dd6: image type and server error fixes

## 0.5.3

### Patch Changes

- d2f86a2: Package and readme update with beta status and improved definitions.

## 0.5.2

### Patch Changes

- b4a6596: Readme update

## 0.5.1

### Patch Changes

- 3dc87f3: type fix

## 0.5.0

### Minor Changes

- 1c1080a: xhr fix

## 0.4.2

### Patch Changes

- 9666c61: Readme updates include npm badge
- 97d28e7: Build size reduction

## 0.4.1

### Patch Changes

- aa35c10: added build scriopt

## 0.4.0

### Minor Changes

- 11f3bcf: Workflow fixes caching

### Patch Changes

- b253f91: Publish script fix
- 46fec2c: order of install fix to handle cache
- 5457c28: strict version

## 0.3.0

### Minor Changes

- dc757fe: limmited test run and workflow fixes

## 0.2.0

### Minor Changes

- f7c94d3: Initial npm release

### Patch Changes

- 11aa593: removed demo deployment
- e6c03ee: npm release
- 8e27de5: npm release test
