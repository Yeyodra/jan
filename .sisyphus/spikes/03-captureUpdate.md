# Spike 03 — Excalidraw `captureUpdate` history-coalescing API

**Wave:** 1
**Task:** T3
**Date:** 2026-06-16
**Branch:** `feat/excalidraw-mcp`
**Status:** ✅ Complete

## Verdict

**Use `captureUpdate` API.** No fallback ("custom undo grouping at canvas-store layer") needed.

Rationale (one paragraph):
The Excalidraw 0.18.1 imperative API exposes a public, runtime-importable enum
`CaptureUpdateAction` with the exact three values the plan assumed —
`IMMEDIATELY`, `NEVER`, `EVENTUALLY`. The implementation of `App.updateScene`
(read directly from the shipped dev bundle, lines L25932-25956) explicitly
gates store interaction on this field. `NEVER` advances the store's snapshot
baseline silently without emitting a history entry; `IMMEDIATELY` calls
`store.captureIncrement(...)` to emit exactly one history increment diffed
against that snapshot. The pattern `N × NEVER → 1 × IMMEDIATELY` therefore
collapses an arbitrary batch into a single undo step by construction. Custom
undo grouping at our canvas-store layer would be strictly redundant and
would also have to fight against Excalidraw's own internal capture triggers
(every built-in action goes through the same enum-driven path, see
`syncActionResult` at L25119-25127).

## Confirmed enum contract

Source-of-truth file:
`web-app/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/store.d.ts`
(lines 7-39, verbatim quote in
`.sisyphus/evidence/task-3-captureUpdate-source-quote.md`).

Public re-export:
`web-app/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/index.d.ts`
L23 → `export { CaptureUpdateAction } from "./store";`
The enum is importable as a runtime value:
```ts
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
```

| Symbol | Wire value | When to use it (verbatim from upstream JSDoc) | Effect on history stack |
|---|---|---|---|
| `CaptureUpdateAction.IMMEDIATELY` | `"IMMEDIATELY"` | "Use for updates which should be captured. Should be used for most of the local updates." | Calls `store.captureIncrement(...)` → **one new undo entry** diffed against snapshot. |
| `CaptureUpdateAction.NEVER` | `"NEVER"` | "Use for updates which should never be recorded, such as remote updates or scene initialization." | Calls `store.updateSnapshot(...)` → snapshot silently advances; **no history entry.** |
| `CaptureUpdateAction.EVENTUALLY` | `"EVENTUALLY"` | "Use for updates which should not be captured immediately - likely exceptions which are part of some async multi-step process. Otherwise, all such updates would end up being captured with the next `CaptureUpdateAction.IMMEDIATELY` - triggered either by the next `updateScene` or internally by the editor." | Gated out entirely at `App.updateScene` L25935 → no store interaction. The increment is realized later when the next `IMMEDIATELY` (from any source) fires. |
| *(absent / `undefined`)* | — | Not documented. | **Same as `EVENTUALLY`** — gated out at L25935; silently a no-op for history. **This is a foot-gun.** Wave 4 must always pass an explicit value. |

The `updateScene` payload type that carries the field (verbatim from
`dist/types/excalidraw/types.d.ts` L464-469):
```ts
export type SceneData = {
    elements?: ImportedDataState["elements"];
    appState?: ImportedDataState["appState"];
    collaborators?: Map<SocketId, Collaborator>;
    captureUpdate?: CaptureUpdateActionType;
};
```

## Does Jan already use this?

**No.** Exhaustive grep across `web-app/src` for `captureUpdate`,
`updateScene`, and `CaptureUpdateAction` returns three hits, all in JSDoc /
inline comments — zero call sites. Details + grep output in
`.sisyphus/evidence/task-3-canvas-editor-current-usage.md`.

Implication: T17 is greenfield wiring. The contract documented in this spike
is the spec to implement against.

## Recommended pattern for the AI batch (T17)

```ts
// Pseudo-code for the orchestrator the AI tool dispatcher will own.
// Lives in the canvas-store layer, NOT in CanvasEditor.tsx.

import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

async function applyAiBatch(
  api: ExcalidrawImperativeAPI,
  batch: ReadonlyArray<SceneMutation>, // tool-call results, in order
) {
  // Build the running scene by accumulating each mutation's element delta.
  // We must call updateScene after each delta so the canvas paints
  // intermediate state (UX requirement: user sees the AI "drawing").
  let elements = api.getSceneElements().slice()

  for (let i = 0; i < batch.length - 1; i++) {
    elements = applyMutation(elements, batch[i])
    api.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.NEVER, // intermediate paint, no history
    })
  }

  // Final commit: ONE history increment for the whole batch.
  if (batch.length > 0) {
    elements = applyMutation(elements, batch[batch.length - 1])
    api.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY, // commits exactly one undo step
    })
  }
}
```

Key points:
- Always pass an explicit `captureUpdate` (never let it default).
- Use `CaptureUpdateAction.NEVER` for every intermediate call (strictly
  required for the coalescing semantics).
- Use `CaptureUpdateAction.IMMEDIATELY` only on the final call.
- A batch of size 1 is just a single `IMMEDIATELY` call.
- A batch of size 0 must not call `updateScene` at all.

## Edge case: interleaving (informs T22)

Full source-derived analysis in
`.sisyphus/evidence/task-3-interleaving.txt`.

Summary:
If a manual user edit lands as an `IMMEDIATELY` `updateScene` *between* an
in-flight AI batch's `NEVER` calls and its final `IMMEDIATELY`, the elements
already absorbed into the snapshot via `NEVER` become **silently undoable
through nothing** — they are baked into the snapshot baseline. The user has
no way to undo them.

Behaviour breakdown (3-step interleaved sequence):

| Step | Call | Snapshot after | History entries | What `Ctrl+Z` would revert |
|---|---|---|---|---|
| 1 | AI: `NEVER` adds `ai1` | `[ai1]` | 0 | n/a |
| 2 | User: `IMMEDIATELY` adds `user1` | `[ai1, user1]` | +1 (diff = added `user1` only) | only `user1` — `ai1` is unreachable |
| 3 | AI: `IMMEDIATELY` adds `ai2`, `ai3` | `[ai1, user1, ai2, ai3]` | +1 (diff = added `ai2`, `ai3`) | only `ai2`, `ai3` |

Per Excalidraw's documented semantics this is *correct* — `NEVER` literally
means "never recorded". But for our use case it is user-hostile.

**T22 must enforce mutual exclusion** between an in-flight AI batch and any
user-initiated `updateScene`. Two enforcement options:

1. **Lock-based (recommended):** canvas-store sets a `batchInFlight` flag
   while the orchestrator iterates; manual edit handlers (keyboard +
   pointer events into Excalidraw) are masked / queued / disabled until the
   final `IMMEDIATELY` lands. This requires UI affordance (e.g., subtle
   "AI is drawing…" overlay).
2. **Fragmentation fallback:** swap intermediate `NEVER` for `EVENTUALLY`.
   `EVENTUALLY` is gated out of the store branch entirely (L25935), so an
   interleaved user `IMMEDIATELY` only captures the user's diff and the
   AI batch fragments into two history entries instead of leaking. Worse
   UX (multi-undo to revert the AI batch) but no silent loss of undo.

Recommendation: **Use option 1 (lock).** Implement option 2 as a safety net
behind a feature flag in case the lock is ever bypassed.

## QA scenario coverage

| Plan QA scenario | This spike covered it via | Live repro? |
|---|---|---|
| 1. Happy path — N elements coalesce to 1 undo | Source-derived from `App.updateScene` L25932-25956 + enum docstrings | No — deferred to T17 Vitest/Playwright test (see TODO below) |
| 2. Interleaving — user edit between AI batch | Source-derived analysis in `task-3-interleaving.txt` | No — deferred to T22 regression test |

## TODOs the spike does NOT discharge (handed off)

- **T17:** Add a Playwright or Vitest test that mounts Excalidraw, runs the
  3-call sequence (`NEVER`, `NEVER`, `IMMEDIATELY`), and asserts that
  exactly one undo restores the pre-batch state. This converts the
  source-derived contract above into a runtime regression check. The
  spike was deliberately scoped to the source read because (a) the answer
  was already in the local types, (b) the plan permits "best-effort —
  if a full repro isn't feasible without a running Excalidraw mount,
  document carefully from source instead", and (c) the runtime check
  belongs in the orchestrator's own test surface, not in a throwaway
  HTML scratch.
- **T22:** Add a regression test for the interleaving sequence (table in the
  edge-case section above). The expected behaviour is documented; the test
  asserts it.

## Files produced by this spike

- `.sisyphus/spikes/03-captureUpdate.md` — this report.
- `.sisyphus/evidence/task-3-captureUpdate-source-quote.md` — verbatim
  upstream type + bundle quotes.
- `.sisyphus/evidence/task-3-canvas-editor-current-usage.md` — Jan's
  current usage (zero call sites).
- `.sisyphus/evidence/task-3-interleaving.txt` — source-derived analysis
  of QA Scenario 2.
- Notepad append: `.sisyphus/notepads/excalidraw-mcp-canvas-integration/learnings.md`.
