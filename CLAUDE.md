# image-cache-pro — working notes for Claude Code

## What this repo is

Framework-agnostic (vanilla TS) image-caching + pre-rendering scheduler. Its job:
**stage image decode and GPU upload so hardware processes a few images per frame,
off the interaction critical path** — with bounded RAM/GPU budgets and eviction.

Built to fix a measured STB problem: on **Cobalt** (Chrome-88-class STB browser),
painting a whole rail of poster images at once causes a **simultaneous decode + GPU
blit stampede** that spikes the render thread and janks navigation. This lib serialises
that work.

## The bigger picture (read before large changes)

This repo is one half of a two-repo effort (sibling: `../image-cache-pro-react`):

1. **This repo, now:** refactor the vanilla lib to a production-grade, Cobalt-correct,
   fully-tested, npm-publishable baseline — see **[`HANDOFF.md`](./HANDOFF.md)** for the
   full spec (invariants, pacing rewrite, priority lanes, memory audit, verification
   plan). Current work branch: **`refactor/production-grade`**.
2. **Next (sibling repo):** a React binding lib over the published core.
3. **After:** `@oregannetworks/react-kit` consumes the React binding and wires it into
   its `Icon` component — **opt-in, zero default behaviour change.**

**`HANDOFF.md` is the source of truth for the refactor.** Start there.

## Architecture (current)

Three-tier model — keep it, harden it (`HANDOFF.md` §5):

- **`src/lib/controller`** — global budgets (ram / video / loaders / hwRank /
  gpuFullMode) + the injectable `renderer`.
- **`src/lib/bucket`** — a group of images (one per rail/page), with a lock.
- **`src/lib/request`** (`RenderRequest`) — one image at one size.
- **`src/lib/frame-queue`** — serialises GPU warms; **currently `setTimeout`-paced —
  the handoff calls for an rAF + per-frame-budget rewrite** (Cobalt `setTimeout(0)`≈41ms).
- **`src/lib/{image,loader,memory,network,logger}`** — decode/fetch/accounting/events.
- **`src/utils/image-decoder`**, `image-type` — custom header size-sniffers; the handoff
  makes these **optional/lazy** (bypass when the caller supplies `size`).

The renderer forces a GPU upload via a hidden in-viewport `opacity:0.001` bg-image div
at target size — **load-bearing Cobalt invariant** (off-screen won't upload); see
`HANDOFF.md` §1.

## Tooling

- **pnpm**, Vite lib build (dual ESM+CJS), **`tspc`** for `.d.ts` (typescript-transform-paths),
  Vitest, ESLint flat config, changesets.
- Path aliases: `@lib/*`, `@utils`.
- **Heads-up:** `test` currently only runs `src/lib/network/` — broadening coverage is a
  Pass-2 work item (`HANDOFF.md` §4).

## Commands

```sh
pnpm run build     # clean + vite (esm+cjs) + tspc (.d.ts)
pnpm test          # vitest (NOTE: currently scoped to src/lib/network/)
pnpm run lint
```

## Constraints

- **Never publish yourself.** `changeset publish` / `npm publish` / version bumps are
  Sam's job. Writing a `.changeset/*.md` entry is fine.
- Verify a diff and wait for approval before committing.
- On-box verification uses the onyx-core `debug-stb-cobalt` skill's telnet metrics —
  **never devtools :9227** (freezes Cobalt).
