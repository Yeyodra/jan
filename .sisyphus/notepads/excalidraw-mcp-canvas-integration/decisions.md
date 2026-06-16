# Decisions — excalidraw-mcp-canvas-integration

## [2026-06-16] Branch Strategy
- Created `feat/excalidraw-mcp` from `main` (not from `feat/compare-feature` as plan assumed — that branch is already merged).
- All Wave 1-5 commits go here. Final PR target: `main`.

## [2026-06-16] Pre-Plan Steps 0a-0d — SKIPPED
- Plan written before PR merges; checklist is moot.
- T18 chat-dispatcher wiring exists (different layer) — functionally complete.
- Dirty tree (yarn.lock, plugin permissions) discarded with `git checkout -- .` — pure regen noise.

## [2026-06-16] Plan ref drift
- Plan refers to `hooks/use-chat.ts` + `routes/threads/$threadId.tsx` for canvas tool wiring; reality is `hooks/useAppState.ts` + `hooks/useTools.ts`. Any task that says "modify use-chat.ts to register canvas tools" must instead modify `useAppState.ts` / `useTools.ts`. Document discoveries as we go.

## [2026-06-16] T1 verdict: FAIL — Wave 2 gated until dispatcher fix

**Decision:** Tasks 2, 3, 4, 5, 7, 8 (all of Wave 2) cannot start. T18's dispatcher layer was never wired (see issues.md). The fix is small (~30 lines) but must land in routes/threads/$threadId.tsx — outside T1's allowed-edit set.

**Rationale:**
1. Vitest 19/19 PASS confirms Layers 1 & 2 (tool authoring, registry projection) are correct.
2. Static analysis of `routes/threads/$threadId.tsx`:313-366 proves Layer 3 (dispatcher) has no canvas branch.
3. Real-LLM run was skipped because the dispatcher bug guarantees every tool call would error out — running Playwright would only photograph the same error five times.
4. Per the task spec, we documented the blocker explicitly and produced the report at tests/manual/t18-tools-verification.md.

**Plan reference drift confirmed:**
- Plan cites `hooks/use-chat.ts` (does not exist).
- Plan cites `routes/threads/$threadId.tsx` for wiring (correct file, but contains no canvas wiring as of feat/excalidraw-mcp HEAD).
- Real registry layer: `hooks/useTools.ts` + `hooks/useAppState.ts` (correct).
- Real dispatch layer: `routes/threads/$threadId.tsx` (correct file, missing canvas branch).

**Follow-up task to spawn (T1.5):** dispatcher canvas-route — modify `.tsx` to read canvasToolNames, route via canvasBuiltinToolsByName, marshal results into MCPToolCallResult, and update the approval gate. Then re-run T1 against a live Jan to capture the Playwright evidence the plan calls for.



## [2026-06-16] T1.5 — Option A (helper extraction) chosen over Option B (in-place test)

**Decision:** Extracted `dispatchCanvasTool` into `web-app/src/lib/canvas/dispatch.ts` (pure helper, ~80 lines) and unit-tested THAT instead of mocking the entire `$threadId.tsx` route module.

**Rationale:**
- The dispatch logic (resolve handler → invoke → marshal into envelope → catch errors) is a self-contained transformation with one input shape (toolName + args) and one output shape (`MCPToolCallResult`). It does not need access to React, the router, the serviceHub, or any zustand stores beyond `canvasBuiltinToolsByName` (which is itself a static module-level constant).
- Mocking `$threadId.tsx` would require stubbing `useAppState`, `useToolApproval`, `useServiceHub`, `useChat`, `useMessages`, and several others — none of which exercise the actual logic under test.
- Helper extraction lets the same module be reused if T20 (canvas tool source registration) ever needs to dispatch from a non-route context.
- The injected `deps.byName` parameter exists ONLY for test isolation (proving the registry parameter is honored) — production callers pass `(toolName, args)` only.

**Trade-off accepted:** The approval-gate predicate `isAutoApproved` is duplicated between `$threadId.tsx` (production) and `dispatch.test.ts` (test). To catch drift, the test suite includes a "mutatingToolNames" sanity assertion (`expect([...mutatingToolNames].sort()).toEqual([create, delete, update])`) that fires if anyone reorders the canonical set without updating the test. Acceptable for v1; if the predicate grows beyond a one-liner, extract it into the same `dispatch.ts` module.

**Commit:** `fix(canvas): wire T18 canvas tools into thread dispatcher` (atomic, single commit per task spec §5).
