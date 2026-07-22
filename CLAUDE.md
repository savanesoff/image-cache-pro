# image-cache-pro — working notes for Claude Code

## What this repo is

Framework-agnostic (vanilla TS) image-caching + pre-rendering scheduler. Its job:
**stage image decode and GPU upload so hardware processes a few images per frame,
off the interaction critical path** — with bounded RAM/GPU budgets and eviction.

Built to fix a measured STB problem: on **Cobalt** (Chrome-88-class STB browser),
painting a whole rail of poster images at once causes a **simultaneous decode + GPU
blit stampede** that spikes the render thread and janks navigation. This lib
serialises that work. The README is the public, authoritative feature/API doc —
keep it in sync with code changes.

## The bigger picture (read before large changes)

This repo is one half of a two-repo effort (sibling: `../image-cache-pro-react`):

1. **This repo:** the production-grade, Cobalt-correct, fully-tested,
   npm-published core (work branch: `refactor/production-grade`).
2. **Next (sibling repo):** a React binding lib over the published core.
3. **After:** `@oregannetworks/react-kit` consumes the React binding and wires it
   into its `Icon` component — **opt-in, zero default behaviour change.**

`HANDOFF.md` (local, untracked — internal notes) holds the original refactor spec
and status; don't reference it from public docs.

## Architecture

Three-tier model: `Controller` (budgets, network queue, frame queue) →
`Bucket` (one UI region: priority, lock, pause/resume, optional GPU cap) →
`RenderRequest` (one image at one size). Supporting modules:

- **`src/lib/frame-queue`** — rAF-driven, per-frame `{bytes, ms}` budget scaled
  by `hwRank`, priority-sorted, `canRender()` input-yield gate.
- **`src/lib/renderer`** — injectable warm strategy; the default paints a hidden
  **in-viewport `opacity:0.001`** div at target size — **load-bearing Cobalt
  invariant** (off-screen/`opacity:0` won't upload; documented in the module).
- **`src/lib/{image,loader,memory,network,logger,emitter}`** —
  decode/fetch/accounting/typed-events. Zero runtime dependencies.
- **`src/utils/image-decoder`** — header size-sniffers, lazily imported; bypassed
  entirely when the caller supplies `size` (preferred).

## Tooling

- **pnpm**, Vite lib build (ESM + `.cjs` CJS + `.d.ts` via `vite-plugin-dts`,
  `chrome88` target), Vitest (unit), Playwright (e2e over `demo/`), ESLint 10
  type-checked flat config, prettier-separate, changesets.
- Path aliases: `@lib/*`, `@utils`, `@utils/*`, `@mocks/*`.
- `demo/` is Cobalt-first (legacy bundle via `@vitejs/plugin-legacy`,
  `polyfills: false`, NodeList iterator shim) and deploys to GH Pages on main.

## Commands

```sh
pnpm run build     # clean + vite (esm+cjs+d.ts)
pnpm test          # vitest, full suite
pnpm run test:e2e  # playwright over the demo
pnpm run lint      # prettier --check + eslint
pnpm run type-check
pnpm dev           # serve the demo
```

## Constraints

- **Never publish yourself.** Merging to `main` publishes via CI (changesets,
  direct flow — no Version Packages PR). Writing a `.changeset/*.md` entry is
  fine; running version/publish locally is not.
- Verify a diff and wait for approval before committing.
- On-box verification uses the onyx-core `debug-stb-cobalt` skill / mcp-zids
  telnet metrics — **never devtools :9227** (freezes Cobalt).
