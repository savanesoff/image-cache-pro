---
'image-cache-pro': minor
---

Production-grade refactor, Pass 1 (Cobalt-correct scheduling):

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
