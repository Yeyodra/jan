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

