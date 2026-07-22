---
'image-cache-pro': minor
---

Production-hardening pass (Pass 2): versatility, resilience, packaging.

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
