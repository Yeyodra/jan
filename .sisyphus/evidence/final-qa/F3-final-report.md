# F3 Manual QA Report — excalidraw-mcp-canvas-integration

## Runtime mode used
**Vitest-fallback** (live Tauri unreachable in this session).

The full live runtime would require `yarn dev:tauri`, which chains
`build:icon → copy:assets:tauri → tauri dev` (Rust compile of `src-tauri`).
That toolchain is not feasible to launch+stabilize+exercise inside a single
QA pass here. Each scenario's contract is therefore verified against the
existing 11 vitest suites that exercise the production code paths the
`/canvas/$canvasId` route actually uses at runtime. All 203 tests in those
suites passed (`Test Files 11 passed (11) | Tests 203 passed (203)`, full log
at `.sisyphus/evidence/final-qa/all-vitest-runs.log`).

## Scenarios

1. Toggle ON flow — **PASS** — evidence: `.sisyphus/evidence/final-qa/scenario-1-toggle-on-flow.txt`
   Backed by: 5 cases in `canvasId.test.tsx`, 16 in `CanvasPromptBar.test.tsx`,
   15 in `CanvasAiIndicator.test.tsx`, 14 in `batch.test.ts` (single-step undo).

2. Toggle OFF — **PASS** — evidence: `.sisyphus/evidence/final-qa/scenario-2-toggle-off.txt`
   Backed by `canvasId.test.tsx`'s "does NOT render prompt bar / indicator /
   lock banner when toggle is off" — direct contract test against the same
   conditional mount in production.

3. Approval modal — **PASS** — evidence: `.sisyphus/evidence/final-qa/scenario-3-approval-modal.txt`
   Backed by 6 approval-gate cases in `dispatch.test.ts` + 3 orchestrator-level
   cases in `index.test.ts` covering approve / deny / fail-closed / readonly-
   bypass branches.

4. `export_to_image` filtered — **PASS** — evidence: `.sisyphus/evidence/final-qa/scenario-4-export-to-image-filtered.txt`
   Two-layer defence verified: 46 `curated-tools.test.ts` cases on the
   advertise-time filter + explicit "rejects a blocked tool (export_to_image)
   without invoking approval or mcp" case at the dispatch layer. No code path
   reaches mcp for `export_to_image`.

5. Manual edit lock — **PASS** — evidence: `.sisyphus/evidence/final-qa/scenario-5-manual-edit-lock.txt`
   Backed by 15 `lock.test.ts` cases (refcount, idempotent unlock, observer,
   forceUnlock zombie recovery), 6 `CanvasManualEditLockBanner.test.tsx` cases
   (banner visibility + a11y + non-blocking), and 11 `beginAiBatch/endAiBatch`
   wiring cases in `batch.test.ts` + `index.test.ts`. The route correctly
   propagates `viewModeEnabled` to the Excalidraw editor.

6. Process crash → auto-restart — **DEFERRED** — evidence: `.sisyphus/evidence/final-qa/scenario-6-process-crash.txt`
   `handleProcessCrash` is intentionally still a TODO thrower per plan §1411
   and the in-file note in `index.test.ts:53-54` ("intentionally left as a
   TODO thrower until the crash-restart wiring lands — separate sub-task").
   The underlying rmcp/`start_mcp_server` health-monitor restart is plan-§261
   noted as already-existing infrastructure outside this slice. The TODO
   thrower is itself test-asserted (passing), so the surface is fail-loud.
   This is a known, planned deferral — NOT a regression.

## Edge cases observed

- **Fail-closed allow-list at dispatch.** Even if a tool somehow bypasses the
  advertise-time filter, the dispatch path's allow-list gate refuses the call
  before reaching the approval modal or the mcp transport. Two-layer defence
  is the right shape for security-critical tool gating.
- **Idempotent unlock + refcount safety.** The lock controller refuses to go
  negative on spurious unlocks, and only fires its observer on actual state
  transitions. This matters because a buggy AI batch could in theory call
  unlock() twice — the production code is defensively shaped against this.
- **forceUnlock + forceEndBatch zombie-recovery primitives are landed**, even
  though `handleProcessCrash` itself is TODO. So when the crash-handler does
  land, it has the primitives it needs already verified.
- **Banner is non-blocking.** The lock banner has `pointer-events: none` on
  its wrapper — verified by a dedicated test — so it can never visually
  obscure or steal clicks from the canvas, even when isLocked=true.
- **Read-only canvas tools auto-approve** (`canvas_list`, `canvas_read`).
  Mirrors the existing `$threadId.tsx` predicate — no modal noise on safe
  introspection calls.
- **viewModeEnabled=false is the default** (canvasId test). No risk of
  shipping with the canvas accidentally locked open from a stale flag.

## Limitations

- **No live Tauri click-through** for any scenario. The Rust toolchain compile
  is too heavy for this session. Every scenario is verified at the React /
  orchestrator contract level, not at the visual UX level.
- **Single-step undo (Cmd+Z)** is verified at the batch-controller level
  (single Excalidraw history commit per AI batch) but the keystroke itself
  was not exercised against a live Excalidraw instance. This is the area
  most exposed to "but does it actually feel right in practice?" risk.
- **The approval modal's React component** is shared with the existing
  `$threadId.tsx` flow and was not re-verified under the canvas route
  specifically. If there's a mount-context bug, it would surface at runtime,
  not in vitest.
- **handleProcessCrash live behaviour** is deferred (see scenario 6). The
  underlying rmcp restart is not re-verified here; we trust plan §261 that
  it's a pre-existing capability.

## Final

Scenarios **5/6 pass, 1/6 deferred (with documented reason)** | Integration **5/6 contract-proven** | Edge Cases **6 observed** | **VERDICT: APPROVE**

### Why APPROVE despite scenario 6 being DEFERRED

Per the F3 brief: "APPROVE is still possible if you can show every scenario's
contract is covered by a passing vitest case, AND you clearly document the
live-runtime gap as a known follow-up. REJECT only if a contract is BROKEN,
not because the runtime was unavailable."

- Scenarios 1-5: every contract has at least one passing vitest case backing
  it, and the route page production code matches what the tests exercise.
- Scenario 6: `handleProcessCrash` is **intentionally** still a TODO per the
  plan itself (§1411). It is not a contract this slice promised to deliver.
  The TODO state is itself test-asserted as a fail-loud surface. The
  underlying mcp-server restart is owned by an out-of-scope subsystem the
  plan trusts as pre-existing.

No contract is broken. The single deferral is plan-sanctioned and fail-loud.
The full test suite (203/203) passes clean.
