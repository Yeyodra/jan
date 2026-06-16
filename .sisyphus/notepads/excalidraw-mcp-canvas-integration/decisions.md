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

## T5 — Vendor mcp_excalidraw at c12ff87f (2026-06-16)

- **Decision**: Do NOT vendor `node_modules/`. Defer install to Tauri build hook (T11).
  - **Rationale**: Full `node_modules` is ~hundreds of MB of mostly devDeps. Runtime
    needs only a subset of `dependencies` which the build hook can `npm ci` on-demand.
    Vendoring would balloon repo size + violate the project's repo-size hygiene.
  - **Tradeoff**: T11 must succeed reliably or sidecar won't launch. Mitigated by
    SHA-256 verification of `dist/index.js` in UPSTREAM.md (contract for T11).
- **Decision**: Keep upstream's `.gitignore` intact (vendor as-is) and use `git add -f`
  for files it excludes (`dist/`, `package-lock.json`, `.dockerignore`, etc).
  - **Rationale**: Modifying upstream files breaks the "vendor as-is for upstream parity"
    rule. `git add -f` is the canonical vendoring workaround.
- **Decision**: Refactor root `.gitignore` line 66 from blanket `src-tauri/resources/`
  to explicit subpaths (`src-tauri/resources/lib`; `bin`/`pre-install`/`icons` already
  listed earlier). Reason: blanket directory ignore makes child negations impossible per
  gitignore semantics, blocking future vendored sidecars.
- **Pinned dist SHA-256**: `DC1E55ED8C1CB2E2354794C8FDE34A707D3B6E9E824C617C949B550106EFA0BC`
- **Vendored file count**: 211 files

## [2026-06-17] T14 — Empty-canvas sync: short-circuit, don't propagate the wire error

**Decision:** `syncStateFromCanvas` does NOT call `mcpClient.callTool({name: 'import_scene', ...})` when the active canvas has zero elements. It records a debug log (`"empty canvas"`) and returns `{ status: 'skipped', reason: 'empty-canvas' }`.

**Rationale:** mcp_excalidraw's `import_scene` handler (vendored at `src-tauri/resources/mcp_excalidraw/dist/index.js:1400-1402`) throws `"No elements found in the import data"` when the elements array is empty. Our error-swallowing branch would handle that gracefully, but every empty-session start would log a known no-op error and increment failure counters. Short-circuiting BEFORE the wire call keeps telemetry clean and removes a needless round trip.

**Alternative considered:** Call `import_scene` with `elements: []` and let the error branch absorb it. Rejected because (a) the error is informationally vacuous (we caused it intentionally), and (b) it adds wire latency for the no-op case.

## [2026-06-17] T14 — No `getActiveCanvasId` selector added to canvas-store

**Decision:** Did NOT add a `getActiveCanvasId()` selector to `web-app/src/stores/canvas-store.ts`. The plan suggested adding one "if not already present"; we audited the store and concluded the request stems from a conceptual mismatch.

**Rationale:**
1. The canvas store is a pure library/repository — it owns a `Record<string, Canvas>` keyed by id. It has no notion of "active" canvas; that concept belongs to the router.
2. Implementing the selector would have only two shapes:
   - **(a) Store-tracked active id** — adds a new `activeCanvasId: string | null` field plus an action to mutate it. Requires schema change. VIOLATES the plan's "no schema change" constraint and creates a second source of truth for routing state.
   - **(b) Router-aware helper colocated with the store** — would require importing `@tanstack/react-router` from the store module, dragging React-Router into a previously framework-agnostic file. Also wrong layering.
3. The canonical "active canvas id" reader is `resolveActiveCanvas(router)` in `web-app/src/lib/canvas-mcp-orchestrator/active-canvas.ts`. Consumers that need it import from there. One selector, one place, no duplication.

**Plan checkbox:** Treated this sub-item as resolved-by-design and noted the rationale here. If a later wave really needs `getActiveCanvasId` for non-orchestrator code, we can re-export it from a router-utils module without touching the store.

## [2026-06-17] T14 — Idempotency key = per-instance object token (orchestrator owns one)

**Decision:** `CanvasMcpOrchestrator` allocates a fresh `private readonly sessionToken: object = {}` per instance and threads it into every `syncStateFromCanvas` call. The active-canvas helper records synced tokens in a module-scoped `WeakSet<object>`.

**Rationale:**
- Plan says "double-call of `syncStateFromCanvas` is idempotent (second is no-op)". The natural unit of "one session" is one orchestrator instance — the plan's separate Wave-4 task T17 (`beginAiBatch`/`endAiBatch`) already assumes one orchestrator per session.
- `WeakSet<object>` lets the GC reclaim tokens once the orchestrator (and thus the session) is dropped — no manual cleanup needed.
- The helper also accepts `string` and `symbol` tokens (Set + WeakSet hybrid) so tests can use cheap string keys without leaking `WeakSet`'s ergonomics into the test code.


## T15 (2026-06-17) — dispatch helper design choices

### Why threadId via constructor + `setThreadId` arrow (not per-call arg)
Plan says "the orchestrator receives `threadId` when a session starts". Three options considered:
1. Per-call arg `dispatchToolCall(call, { threadId })` — verbose at the call-site, every invocation re-supplies a value that should be session-stable.
2. Constructor-only `deps.threadId` — read-only, can't update for orchestrators that outlive a single thread.
3. **CHOSEN**: Constructor-injected `deps.threadId` + arrow-property `setThreadId(id)` — DI-friendly (tests pass via deps), updatable at runtime.

`setThreadId` is defined as an instance arrow property (`setThreadId: (id) => void = (id) => { ... }`), NOT a prototype method, so it does not appear in `Object.getOwnPropertyNames(prototype)` and thus does not break the existing "prototype owns exactly the 11 responsibility methods" reflection test in `index.test.ts`.

### Why fail-closed when approvalGate is missing
A mutating tool reaching dispatch with no gate configured is an installation
bug — either the integration glue forgot to wire `deps.approvalGate`, or the
orchestrator was constructed in a non-renderer context that has no approval
UI. Auto-approving in this state would silently bypass T21. We instead:
- log a warn-level message (developer signal),
- increment `dispatch.approval_gate_missing` telemetry counter,
- return `{ error: 'tool requires approval but no gate configured' }` so the LLM observes the failure and can react.

Read-only tools are unaffected — they bypass approval entirely and work even
without a gate. So a partial wire-up (`mcpClient` set, `approvalGate`
missing) still services queries; only mutations fail closed.

### Why a separate `DispatchMcpClientLike`
`active-canvas.ts` has `McpClientLike` whose `callTool` returns
`Promise<McpToolResult>` (the discriminated union). The T15 dispatcher
takes the WIRE shape (`{ content?, isError?, error?, ... }`) and produces
the discriminated union itself. Reusing the T14 type would force the
caller to pre-marshal — defeating the purpose of centralizing the
wire-handling here. Two distinct types is the right separation.

### Error message constants exported
`ERR_NOT_AVAILABLE`, `ERR_USER_DENIED`, `ERR_GATE_MISSING`,
`ERR_GENERIC_TOOL_ERROR` are all module-level exports. Tests assert
against the constants (when convenient) but also against the literal
strings — both surfaces remain stable contracts.
