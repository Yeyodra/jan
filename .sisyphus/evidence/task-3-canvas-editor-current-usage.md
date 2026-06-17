# Task 3 — Jan's current `captureUpdate` / `updateScene` usage

**Question:** Does Jan's web-app already wire `captureUpdate` (or imperative
`updateScene` calls) anywhere we can lift a known-good pattern from?

**Answer:** No. The only mentions are docstring/comment references that document
the contract for future T11/T14/T17/T22 work. `captureUpdate` is referenced
**zero** times. `updateScene` is referenced **three** times — all as comments
inside JSDoc or inline `//`, never as a function call.

## Grep results (web-app/src, exhaustive)

```
$ grep -nR --include='*.{ts,tsx}' -E 'captureUpdate|updateScene|CaptureUpdateAction' web-app/src
web-app/src/components/canvas/CanvasEditor.tsx:66:
  * automatically reload the scene — call `excalidrawAPI.updateScene(...)`
web-app/src/types/canvas.ts:31:
  * The renderable scene — exactly the shape `excalidrawAPI.updateScene()` accepts.
web-app/src/stores/canvas-store.ts:57:
  * because Excalidraw's `updateScene` does too.
```

All three are doc-only.

## CanvasEditor.tsx — what it actually does today

(`web-app/src/components/canvas/CanvasEditor.tsx`)

- **Imports** (L18-46): only the `Excalidraw` React component (lazy), plus the
  type-only re-exports `ExcalidrawImperativeAPI`, `AppState`, `BinaryFiles`,
  `Collaborator`, `SocketId`, `OrderedExcalidrawElement`. The runtime
  `CaptureUpdateAction` symbol is **not** imported.
- **Seed contract** (L63-77, comment block L64-68 quoted):
  > `initialScene` seeds the editor on first mount; subsequent updates should be
  > applied via the imperative API surfaced through `onApiReady`. … re-rendering
  > with a new value does NOT automatically reload the scene — call
  > `excalidrawAPI.updateScene(...)` via the api handed off through `onApiReady`
  > instead.
- **Imperative API plumbing** (L201-225): handed to the parent through
  `onApiReady` exactly once. Subsequent re-renders do NOT re-fire it. The
  parent (a Wave 4 consumer — `canvas-store` orchestrator T17) is the one that
  will eventually call `updateScene(...)`.
- **Normalizer** (L160-199): hydrates `appState.collaborators` into a real
  `Map<SocketId, Collaborator>` because Excalidraw 0.18.x calls `.forEach(...)`
  on this field unconditionally. This is the only invariant the editor enforces
  on the seed — `captureUpdate` is **not** in scope for the seed because
  Excalidraw's `initialData` is consumed on first mount only and does not flow
  through `updateScene`.

## canvas-store.ts — what it does today

(`web-app/src/stores/canvas-store.ts`, lines around 57)

The comment at L57 (`"because Excalidraw's updateScene does too"`) is part of
JSDoc explaining the store's own `setScene`-style API. The store does not own
the imperative API; it owns the persisted `CanvasScene` shape. There is no
`captureUpdate` plumbing at the store layer today.

## useCanvasAutoSave.ts

The file exists at `web-app/src/hooks/useCanvasAutoSave.ts` but contains
**zero** references to `captureUpdate` or `updateScene`. Auto-save reads
elements out of the `onChange` callback (already wired in CanvasEditor) and
pushes them into the store — it never calls back into the Excalidraw API.

## Implication for T17

Since Jan currently performs no imperative `updateScene` calls at all, T17 is
greenfield wiring. The captureUpdate contract documented in
`task-3-captureUpdate-source-quote.md` is the spec T17 must implement against.
There is no prior pattern in Jan to copy — only the docstring in
`CanvasEditor.tsx` L64-68 promising consumers that the API is reachable via
`onApiReady`.

## Bottom line

- **Existing Jan code that calls `excalidrawAPI.updateScene(...)`:** none.
- **Existing Jan code that sets `captureUpdate`:** none.
- **What this spike must validate:** the upstream type contract (already done
  in `task-3-captureUpdate-source-quote.md`) plus the interleaving edge case
  (see `task-3-interleaving.txt`).
