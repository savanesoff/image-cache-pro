# Handoff — `image-cache-pro`: refactor to a production-grade, Cobalt-correct image scheduler

**Repo:** https://github.com/savanesoff/image-cache-pro (vanilla, framework-agnostic)
**Goal of this work:** bring the vanilla lib to a state-of-the-art, fully-tested,
publishable-to-npm baseline. It will then be consumed (separate session) by a React
binding lib, which react-kit consumes and wires into `Icon`.

This session is **vanilla-only**. Do NOT touch react-kit or the app here.

---

## 0. Why this exists (the problem it must solve)

On low-power STBs running **Cobalt** (Chrome-88-class, Starboard), dumping a whole
rail's poster images to paint at once causes a **simultaneous decode + GPU texture
upload (blit) stampede** that spikes the render thread (~65% Cobalt CPU measured on
a real box during rail nav) and starves the UI (focus animation, scroll). React
re-renders are NOT the cost (measured: ~2–3 card subtrees per nav move); **the cost
is the blit**.

The lib's job: **stage image work so the hardware processes a few images per frame,
off the interaction critical path** — decode ahead to RAM, and stagger the on-screen
GPU uploads — with bounded RAM/GPU budgets and eviction.

---

## 1. Non-negotiable invariants (get these wrong and it silently does nothing)

1. **GPU upload only happens for in-viewport, actually-painted pixels on Cobalt.**
   Cobalt does not rasterize/upload off-screen or non-painting elements. The existing
   `renderer.ts` works _only because_ it appends the warm div **inside the viewport**
   at **`opacity: 0.001`** (non-zero → painted). Any change that moves warming
   off-screen, to `display:none`, `visibility:hidden`, `opacity:0`, or a zero-size box
   **breaks GPU pre-warming with no error**. This must be an explicit, tested,
   commented invariant.
2. **Warming must yield to user input.** Warming is background work; it must never
   block or jank nav. The scheduler must expose a gate the consumer wires to
   input/platform state (pause while a key is down / a scroll animation is in flight,
   resume on idle).
3. **Opt-in / zero-default-impact.** A consumer that doesn't turn it on gets exactly
   today's behavior. This constrains the API shape (see §5): the scheduler must be
   inert until a Controller/Bucket exists and an image is registered.
4. **Deterministic teardown.** Every RenderRequest / Bucket / Img must fully release
   listeners, timers, in-flight network, and memory accounting on clear. No leaks
   across bucket churn (rails mount/unmount constantly).

---

## 2. Cobalt scheduling reality (drives the whole pacing rewrite)

Measured on-box (documented in onyx-core react-kit CLAUDE.md):

| Mechanism                                   | Cobalt timing                        |
| ------------------------------------------- | ------------------------------------ |
| `queueMicrotask` / `Promise.resolve().then` | ~5 ms (queueMicrotask is polyfilled) |
| `setTimeout(0)`                             | **~41 ms**                           |
| `requestAnimationFrame`                     | next vsync, ~16 ms (60 Hz)           |
| `MessageChannel`                            | **absent**                           |

Implication: the current `FrameQueue` paces with `setTimeout(renderTime)`. Small
`renderTime`s floor at ~41 ms → ~24 warms/sec max, and the pacing math
(`bytesUncompressed / bytesPerFrameRatio × (1 − hwRank)`) assumes finer control than
Cobalt gives. **Rewrite pacing around `requestAnimationFrame` with a per-frame budget**
(time or bytes), not `setTimeout` sleeps. Never schedule cleanup with `setTimeout(0)`
next to a state change (race documented in react-kit CLAUDE.md — vanilla lib is less
exposed, but the React binding will be, so keep the timing model clean).

---

## 3. The core design correction (decouple the two costs)

Today the lib conflates "warm" into one hidden-div paint. Split it:

- **Stage A — Decode→RAM (off-screen OK):** decode compressed bytes → bitmap ahead of
  time via the loader / `HTMLImageElement.decode()`. This is CPU/RAM, works hidden, and
  removes the decode stall from the eventual paint.
- **Stage B — GPU blit (on-screen only):** on Cobalt the upload can only be staged by
  controlling **when the real, on-screen element paints/reveals**. Two viable
  mechanisms — decide by probe (§7):
  - **B1 (robust, recommended default): staggered reveal of the real element.** The
    consumer's element starts not-painting the bitmap (no `background-image` yet, or
    `opacity` gated); the scheduler flips them on one-at-a-time across frames. The GPU
    upload happens on the actual on-screen node — no cross-node texture-cache
    assumption.
  - **B2 (current approach): hidden-div pre-warm** (in-viewport, `opacity:0.001`) then
    paint the real node, relying on Cobalt reusing the decoded GPU texture across
    nodes keyed by URL+size. Simpler for warming images whose real element isn't
    mounted yet (e.g. off-window VirtualList slots) — **but only valid if the probe in
    §7 confirms cross-node texture reuse on the target boxes.**

Design the scheduler so the **render mechanism is injected** (the `renderer` override
already exists — keep and formalize it), so react-kit can supply B1 (reveal-gate) or
B2 (hidden div) without forking the core.

---

## 4. Work items (the refactor passes)

### Pass 1 — correctness, pacing, priority, API, opt-in

- **Pacing engine rewrite:** rAF-driven FrameQueue with a configurable **per-frame
  budget** (max ms or max uncompressed bytes per frame). Replace `setTimeout`-sleep
  pacing. Expose `hwRank` still, but as a budget scalar, not a sleep multiplier.
- **Input/idle yield gate:** a pluggable `canRender()` / `pause()`/`resume()` (or an
  injected "is the app busy?" predicate) so warming halts during active input and
  resumes on idle. This is what makes nav stay smooth.
- **Priority lanes:** visible/focused bucket warms first; off-screen buckets low
  priority; support preemption (a newly-focused rail jumps the queue). Today it's FIFO
  - bucket lock — add explicit priority.
- **Decoder bypass:** when the caller provides `size`, skip the custom header decoders
  entirely (BE gives solid sizes in our case). Make the `src/utils/image-decoder/*`
  suite **optional / tree-shakeable / lazy** — not on the default path. Big
  simplification + bundle cut.
- **Cobalt renderer invariant:** codify §1.1 (in-viewport + painted). Use a single
  fixed off-DOM-flow "prewarm layer" container rather than random `document.body`
  appends at random x; keep it in-viewport + `opacity:0.001` + `pointer-events:none`.
  Document loudly.
- **API hardening & opt-in shape:** stable, minimal public surface; typed events end to
  end; inert-until-configured. Lock the entry points (`Controller`, `Bucket`,
  `RenderRequest`) and their option names; treat as semver-public.

### Pass 2 — memory, resilience, benchmarks, docs, publish

- **Memory accounting audit:** RAM (compressed + uncompressed) and GPU (video) budgets;
  `gpuFullMode`/`gpuDataFull` semantics; overflow → eviction correctness; lock
  semantics (visible/locked never evicted); verify no double-count on multi-request
  images and on clear.
- **Loader resilience:** `AbortController` on in-flight fetch (cancel on clear),
  `loaders` concurrency cap respected, retry/backoff, deterministic error surfacing,
  fallback-src handling.
- **Benchmarks / verification harness:** a Cobalt-targeted probe (see §7) plus
  deterministic-timer unit tests (fake rAF/timers). CPU/fps before-vs-after under a
  simulated rail-scroll stampede.
- **Build & publish:** strict TS, dual ESM+CJS + `.d.ts`, correct `exports`/`types`/
  `sideEffects`, tree-shakeable, no `document`/`window` at import time (guarded for
  SSR/test), semver + changesets, **`npm publish --access public`** (published npm —
  the consumer will depend on the public package).
- **DX / docs:** README rewrite (problem → model → API → Cobalt notes → opt-in guide),
  runnable examples, and a short "how a framework binding should consume this" section
  (for the next session's React lib).

---

## 5. Public API shape to aim for (stable, opt-in, injectable)

Keep the three-tier model (`Controller` → `Bucket` → `RenderRequest`) — it's sound.
Harden it:

- `new Controller({ ram, video, units, loaders, hwRank, gpuFullMode, renderer?, frameBudget?, canRender? })`
  - `renderer?` — inject the on-screen reveal (B1) or hidden-div (B2) strategy.
  - `frameBudget?` — ms or bytes per frame (pacing).
  - `canRender?` — predicate/gate for input-yield (returns false → pause).
- `new Bucket({ controller, name, lock?, priority? })` — `priority` new.
- `new RenderRequest({ bucket, url, size, priority? })` — `size` required → decoder bypass.
- Events stay: Controller `ram-overflow`/`video-overflow`; Bucket `rendered`;
  RenderRequest `rendered`/`rendering`/`clear`/`error`/`progress`. Type them precisely.

The React binding (next session) will map: `Controller`→`<ControllerProvider>`,
`Bucket`→`<BucketProvider>`/`useBucket`, `RenderRequest`→`useImage`. Design the core so
that binding is thin.

---

## 6. Explicit non-goals for this session

- No react-kit changes, no app changes, no React binding code (that's the next
  session; only make the core _bindable_).
- Don't keep the Preact-specific `image-cache-preact` assumptions in the core.
- Don't add features beyond the four invariants + the pacing/priority/memory work
  unless they directly serve the STB blit goal.

---

## 7. Verification plan (do this on a real box as you go)

1. **Cross-node GPU texture reuse probe (decides B1 vs B2):** warm image via hidden
   in-viewport `opacity:0.001` div at size S; remove it; paint a _different_ node with
   the same URL+size; measure render-thread CPU on that paint. Flat → B2 reuse works.
   Spikes → reuse doesn't hold; use B1 (reveal-stagger the real node).
2. **Off-screen negative control:** confirm §1.1 — warm the same div _off-screen_ and
   verify it does NOT reduce the later paint cost (proves the in-viewport invariant).
3. **Stampede vs staggered:** simulate a rail scroll-in of N posters; compare
   Cobalt render-thread CPU / dropped frames: all-at-once vs scheduler-staggered.
   Target: p90 render CPU during nav drops materially and stays off the input path.
4. **Budget/eviction under pressure:** exceed RAM/GPU budgets; verify eviction of
   unlocked/off-screen first, no thrash, no re-request storms, locked/visible retained.
5. **Input-yield:** hold a nav key during warm; confirm warming pauses and nav stays
   ~60fps, warming resumes on idle.

Use the onyx-core `debug-stb-cobalt` skill's metrics stream (Cobalt CPU via telnet;
avoid devtools :9227 — it freezes the box) for CPU numbers; the fps overlay for frames.

---

## 8. Open decisions for whoever picks this up

- **B1 vs B2** as the default renderer (probe #1 decides; ship both, default to the
  robust one).
- **Package name/scope** for publish (keep `image-cache-pro` or scope it). The React
  binding + react-kit consumption is the _next_ session; just make sure the published
  core is clean to depend on.
- **`hwRank` source** — static config vs a runtime calibration probe (measure a test
  blit at boot and derive the budget). Nice-to-have, not required for v1.

---

## 9. Status (updated 2026-07-22 — Pass 1 complete)

**Dev env** — deps at latest (TS 6.0.3¹, ESLint 10 flat + typescript-eslint 8
type-checked, Vite 8, Vitest 4, pnpm 11), `.vscode/` tasks (statusbar
Build/Lint/Test/TS/Format via `actboy168.tasks`), CI runs lint + type-check +
full test suite. `tspc`/`ts-patch` replaced by `vite-plugin-dts`.
¹ TS 7 (Go) blocked by typescript-eslint peer `<6.1.0`.

**Pass 1 — done:**

- rAF FrameQueue with per-frame `{bytes, ms}` budget (hwRank = budget scalar),
  priority lanes (bucket/request `priority`), `canRender` gate +
  `controller.pause()/resume()`.
- Injectable `Renderer` (`{ target, done }`); default B2 pre-warm uses one
  fixed in-viewport layer + blob URL; §1.1 invariant documented in code.
- Decoder bypass when `size` supplied; decoder suite lazily imported
  (separate chunk, off the default path).
- Strict zero-dep `Emitter` (typed event maps end to end); `events` + `tslib`
  deps removed.
- Teardown/accounting fixes: blob-URL revoke bug, XHR abort on clear,
  frame-queue removal on request clear, per-texture video charges (no drift),
  symmetric RAM accounting.
- Full spec suite repaired/rewritten — 286 tests, all green; `pnpm test` runs
  everything (was: network/ only).

**Pass 2 — remaining:** loader retry/backoff + xhr timeout, README rewrite,
on-box verification plan (§7 probes — B1 vs B2 decision), benchmarks,
`hwRank` calibration probe (optional).
