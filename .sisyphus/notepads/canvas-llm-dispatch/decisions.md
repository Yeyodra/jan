# Decisions — canvas-llm-dispatch

<!-- Append only. Never overwrite. Format: ## [TIMESTAMP] Task: {task-id} -->

## [2026-06-17] Task: T2

### useChat API surface
- `useChat` (from `@/hooks/use-chat`) wraps `@ai-sdk/react`'s `useChatSDK` and returns its full result spread plus `updateRagToolsAvailability` and `setContinueFromContent`.
- SDK `status` values: `'submitted' | 'streaming' | 'ready' | 'error'` — mapped to canvas-facing `'submitting' | 'streaming' | 'idle' | 'error'`.
- `sendMessage` accepts `{ role, parts }` object (UIMessage shape) OR plain string; we pass the parts-object form for explicitness.
- `useChat` accepts `sessionId`, `systemMessage`, `onFinish` in its options — all used by `useCanvasChat`.

### Transport stabilization approach
- `useChat` owns the `transportRef` internally — it already does NOT recreate transport on re-render.
- `useCanvasChat` does NOT need its own `transportRef`; simply passing a stable `sessionId` is sufficient to get session-persisted transport reuse via `useChatSessions` store.
- Tool definitions stabilized via `toolDefsRef` (computed once on first render, never recreated).

### Tool definition shape
- `getExcalidrawCuratedToolDefinitions()` added to `curated-tools.ts` — returns `Record<string, Tool>` using `jsonSchema({ type: 'object', additionalProperties: true })` stubs.
- Derives exclusively from `EXCALIDRAW_ALLOWED_TOOLS` — no separate hardcoded list.
- Descriptions are placeholders (`mcp_excalidraw tool: <name>`); real schemas come from live `tools/list` at runtime.
- Note: `useCanvasChat` currently does NOT pass this tool record to `useChat` — the transport handles tool loading from MCP. The function exists for future use by T6/orchestrator wiring.

### Minimal API surface decision
- Returned: `{ sendMessage, stop, status, error }` — no `messages`, no `addToolOutput`, no RAG methods.
- `onToolCall` / `onFinish` forwarded via stable refs to avoid re-creating `useChat` options on every render.
- `CANVAS_SYSTEM_PROMPT` defined as a named const at file top per spec.

### Session ID collision prevention
- `sessionId: 'canvas-' + canvasId` — prefix ensures canvas sessions never collide with chat thread sessions (which use raw `threadId`).

### Test approach
- Vitest + `@testing-library/react` `renderHook`.
- `useChat` mocked at module level via `vi.mock('@/hooks/use-chat')` — `vi.mocked(useChat)` used to introspect call args (avoids `require()` inside test body which bypasses Vitest module registry).
- 12 tests, all passing.

## [2026-06-17] Task: T1 � Wire orchestrator deps in canvas route

### Wiring approach chosen

**Router:** useRouter() from @tanstack/react-router added to the CanvasDetail component. The hook returns a stable object matching RouterLike = { state: { matches: [...] } }. No import existed in any canvas route before � added to the existing @tanstack/react-router import statement.

**mcpClient adapter:** MCPService.callTool({ toolName, serverName?, arguments }) differs from McpClientLike.callTool({ name, arguments }). Thin adapter created inline via useMemo([serviceHub]):
`	s
callTool: (call: McpToolCall) =>
  serviceHub.mcp().callTool({ toolName: call.name, arguments: call.arguments })
    .then(result => result as McpToolResult)
`
useServiceHub() returns a stable zustand singleton, so mcpClient identity is stable across renders.

**canvasStore:** Passed as useCanvasStore (the zustand hook itself, typed unknown at the deps slot). The orchestrator's syncStateFromCanvas (T14) will narrow it to CanvasStoreLike at the call site.

**excalidrawAPI (late binding):** No setExcalidrawAPI() method exists on the orchestrator. The BatchController stores the API at construction time from deps.excalidrawAPI. Since ExcalidrawImperativeAPI is unavailable on first render (Excalidraw mounts async), we:
1. Pass no excalidrawAPI at construction (batch ops are fail-closed no-ops until set � documented in batch.ts)
2. Use useEffect(() => { if (apiRef.current) { (orchestrator as �).deps.excalidrawAPI = api } }) with no deps array to sync the ref after every render
   - deps is protected readonly at TypeScript level but unknown-typed at runtime � cast bypasses compile-time check safely
   - No deps array ensures the ref is always current once Excalidraw mounts

**Memoization stability:** useMemo([canvas.id, mcpClient]) � only recreates when canvas changes (intentional new session) or if mcpClient identity changes (practically never, serviceHub is singleton). Router is intentionally excluded from deps (stable object, not a React state value).

### Gotchas encountered

1. useRouter was not previously used in any route in the project � no existing pattern to copy from. Added straightforwardly per TanStack Router docs.
2. Vitest test for "does NOT recreate orchestrator on re-render" initially failed because the useServiceHub mock returned a new object per call, making mcpClient useMemo recompute. Fixed by making the mock return a module-level stable reference (mirrors the real zustand singleton behavior).
3. 	sc -b --noEmit showed 5 pre-existing errors in unrelated files (JSX namespace in CanvasAiIndicator/CanvasManualEditLockBanner, DialogService type in MasterPromptInput). Zero new errors from this task's changes.

## [2026-06-17] Task: T5a � Bulk-batch approval token

### Decision: BatchApprovalToken as instance-field + instance arrows (not prototype methods)
- setBatchApproval and clearBatchApproval are instance arrow methods (same pattern as setThreadId, pplyDuringBatch, etc.) so they do NOT appear in the prototype and the 11-method OrchestratorResponsibility self-check stays intact.
- atchApprovalToken: BatchApprovalToken | null = null is a private instance field � initialized to null, set by setBatchApproval, cleared by clearBatchApproval and endAiBatch.

### Decision: Token threading via optional DispatchOptions arg on dispatchExcalidrawTool
- Added optional third arg options?: DispatchOptions to dispatchExcalidrawTool � fully backward-compatible (no callers need updating).
- When options.batchApprovalToken is present, Gate 2 (approval modal) is skipped for mutating tools and atch.bulk_approved telemetry is emitted.
- When token is absent, atch.per_call_approved telemetry is emitted and the existing per-call approval path runs unchanged.

### Decision: endAiBatch always calls clearBatchApproval
- Plan �T5a: token must not survive batch boundary. endAiBatch calls 	his.clearBatchApproval() after 	his.lock.forceUnlock().
- Rationale: same cleanup-on-end pattern as orceUnlock � idempotent when already null.

### Decision: OrchestratorResponsibility enum stays at exactly 11
- setBatchApproval / clearBatchApproval are auxiliary lifecycle methods, not one of the 11 plan-defined responsibilities. Not added to enum.

## [2026-06-17] Task: T5b

### Decision: Store was already fully implemented — no changes to useToolApproval.ts
- On inspection, `requestBatchApproval`, `resolveBatchApproval`, `BatchApprovalChoice`, `BatchApprovalRequest` types and state slice were all already present and correct. T5b store work was pre-done.
- Only work needed: ToolApproval.tsx modal extension + tests.

### Decision: Bulk variant uses `if (batchApprovalRequest)` guard at top of component, before per-call guard
- Placing bulk check first means if both somehow coexist (shouldn't, but safe), bulk takes priority. Aligns with task spec: `if (batchApprovalRequest) render bulk variant else render per-call variant`.

### Decision: data-testid on wrapper div inside DialogContent, not on Dialog itself
- Dialog is mocked in tests, so the `data-testid="tool-approval-bulk-modal"` sits on the inner `<div>` wrapping bulk content. This makes it directly queryable via `screen.getByTestId` regardless of Dialog mock shape.

### Decision: Bulk Dialog uses `onOpenChange={() => resolveBatchApproval('cancel')}` for overlay/escape dismiss
- Dismissing the bulk dialog via backdrop/Escape is treated as Cancel, consistent with the explicit Cancel button behavior. No separate close handler needed.

## [2026-06-17] Task: T7

### Decision: Keep stub signature `(result: McpToolResult, ...)` — do NOT change to `(mutations: CanvasMutation[], ...)`
- Task spec §2 describes the parameter as `mutations: CanvasMutation[]` but the actual call site in `$canvasId.tsx` passes `result: McpToolResult`. The stub signature is the authoritative contract; T7 must NOT break the call site.
- Resolution: accept `McpToolResult`, call `orchestrator.translateToolResult(result)` internally to get `CanvasMutation[]`, then dispatch. The task spec was describing internal data flow, not the external API.

### Decision: `reorder` mutation → no `applyDuringBatch` call
- `CanvasMutation { kind: 'reorder', ids }` carries only an id ordering; there is no element data to push via `applyDuringBatch`. Reorder is an ordering-only signal — higher-level scene reconciliation owns it. Silently skip at the apply layer.

### Decision: `update` mutation builds fresh element objects from ids+patch, not fetching from scene
- `applyDuringBatch` expects `ExcalidrawElementLike[]`. For `update`, we construct `{ id, ...patch }` objects per id. We do NOT fetch existing elements from the scene — the batch controller's `updateScene({ captureUpdate: 'NEVER' })` merges into Excalidraw's existing scene state, so only the changed fields need to be supplied.

### Decision: `delete` mutation sends `{ id, isDeleted: true }` stubs
- Excalidraw uses the `isDeleted` tombstone pattern (elements remain in the array but are hidden). Sending `{ id, isDeleted: true }` lets the batch controller push the deletion via the same `applyDuringBatch` path without a separate API.

### Decision: `Logger` type defined locally in `apply.ts`, not imported from `batch.ts`
- `BatchLogger` in `batch.ts` is structurally identical (`debug?/warn?`) but `apply.ts` needs `error?` instead of `debug?`. Defining `Logger` locally avoids a cross-module import and keeps the type minimal. Mirrors the DI-surface pattern used across the orchestrator package.

## [2026-06-17] Task: T8

### Stop button placement (three-state icon swap)
- Added onStop?: () => void to CanvasPromptBarProps`n- Three states: isSubmitting && onStop ? Square (Stop button, data-testid=canvas-prompt-stop); isSubmitting && !onStop ? Loader2 (existing spinner on Send); !isSubmitting ? ArrowRight (Send button)
- Stop button uses 	ype=button to prevent form submission; Send button remains 	ype=submit`n- This keeps the form submission path clean � Stop is a pure action button outside the form submit flow

### Esc handler approach: extend existing window listener (not new ref)
- Task spec said 'canvas viewport ref' but the existing Esc handler already uses window with smart focus exclusions
- Extending the existing handler is less disruptive and avoids a second keydown listener on window
- Added orchestratorState and handleStop to the useEffect deps array (was only [navigate])
- When submitting: handleStop() + e.stopPropagation() ? returns early, navigation branch never runs
- When idle: original navigation behavior with Excalidraw/input exclusion guards preserved exactly

## [2026-06-17] Task: T10 - Auto-save coordination during batch

### Decision: saveFnRef pattern over passing isLockedRef into debounced closure
Extracting the async save body into `saveFnRef.current` (updated every render) decouples the lock check from lodash's debounce instance. The debounced fn never needs recreation; `isLockedRef.current` is always read at fire-time from the ref, not from a stale closure. This is consistent with the existing `onSaveErrorRef`/`canvasIdRef` pattern already in the file.

### Decision: flushOnce calls saveFnRef.current() directly, not debounced.flush()
`debounced.flush()` only fires if a pending trailing call is queued. After `vi.runAllTimers()` drains the timer (even if the lock guard caused early return), the queue is empty — flush is a no-op. `flushOnce` must bypass lodash entirely and call the save fn directly.

### Decision: isLockedRef is a plain React ref, not state
Avoids re-renders on every lock toggle. The ref is written by the `subscribeManualEditLock` observer and read by the debounced save fn — both are side-effect paths that don't need React to re-render.

### Decision: extend existing subscribeManualEditLock subscription (not add new one)
The canvas route already has one subscription for `isManualEditLocked` state. Extended it to also sync `isLockedRef.current` and call `flushOnce()` on unlock. Avoids duplicate subscriptions and keeps all lock-related side effects in one place.

## [2026-06-17] Task: T9

### errorState shape
- { message: string; canRetry: boolean; retryFromIndex: number } | null � retryFromIndex is number of successfully completed tools before error
- Stored as React state (not ref) so banner re-renders when set
- Cleared on retry start and on dismiss

### retryFromIndex tracking approach
- Local successCount variable incremented inside the dispatch loop after each successful iteration
- Avoids reading React state inside async context (stale closure problem)
- cleaner than setProgress functional updater trick

### Dismiss vs Retry semantics
- Dismiss: full batch cleanup (endAiBatch + clearBatchApproval + unlock) � mirrors finally block
- Retry: new AbortController, re-runs dispatch from retryFromIndex, NO sendMessage (no LLM re-call)
- Both: clear errorState immediately so user sees feedback before async work completes

### Banner placement in render
- Inside the relative canvas container div (same as lock banner)
- Outside isExcalidrawActive gate � error state could persist even if toggle changes mid-session
- top-12 vs top-3 for lock banner � both can coexist without overlap

## [2026-06-17] Task: T11 - Mini picker integration into CanvasPromptBar

### modelPicker slot via ReactNode injection
- CanvasPromptBar stays generic - does NOT import CanvasModelPicker directly.
- Added `modelPicker?: ReactNode` to CanvasPromptBarProps; rendered between Input and send/stop button.
- ReactNode injection keeps CanvasPromptBar unit-testable without any picker dependency.

### selectedModel local state initialization
- useState(() => useModelProvider.getState().selectedModel ?? null) reads global default once on mount; local state from then on. V1: no persistence.
- Global Model type mapped to local ModelInfo: { id, name, provider }. Used displayName ?? name ?? id; selectedProvider for provider string.
- Cast `as never` on model arg to useCanvasChat is intentional - local ModelInfo and @janhq/core ModelInfo are structurally compatible for fields useCanvasChat uses.
- Removed `placeholderModel` useRef; replaced with real selectedModel state.

### Test: CanvasPromptBar mock must RENDER the modelPicker slot
- When CanvasPromptBar is mocked in integration tests, the mock must render {props.modelPicker} so the CanvasModelPicker stub inside the slot actually executes.
- If the mock ignores modelPicker, the picker stub never runs and capturedModelPickerProps stays null.

### Test: useModelProvider mock must expose both hook call shape AND .getState()
- Route's useState initializer calls useModelProvider.getState().selectedModel on mount.
- Mock must use Object.assign(hookFn, { getState: () => store }) to cover both surfaces.
- vi.mock calls are hoisted even when placed after the SUT import - placement at end of file is fine.

---

## [2026-06-17] Use setFixedTools() bypass instead of MCP service registration

### Decision
Register canvas tool definitions by adding a setFixedTools() method to CustomChatTransport that short-circuits efreshTools(), rather than registering mcp_excalidraw as a server in the global useMCPServers store.

### Rationale
- Canvas sessions do not use the global MCP service � they use curated tool stubs from getExcalidrawCuratedToolDefinitions(). Actual execution is handled by CanvasMcpOrchestrator via onToolCall, not by the transport's tool dispatch.
- Adding mcp_excalidraw to useMCPServers would require it to be a running server, trigger smart routing, and go through the global tool refresh cycle � all unnecessary for canvas.
- setFixedTools() is minimal: zero impact on the chat thread path (only activates when called, i.e., only for canvas sessions), no new dependencies, backwards compatible.
- The 	oolDefsRef pattern was already in useCanvasChat � the fix just connects the computed stubs to the transport.

### Alternatives Rejected
- Calling updateRagToolsAvailability(true, true, false) to force-enable tools: would load RAG + MCP tools from services, polluting canvas with non-drawing tools
- Passing tools via a CustomChatOptions.initialTools constructor option: requires threading through useChat, more invasive
- Registering mcp_excalidraw in useMCPServers: requires the server to be running and changes global state affecting all sessions
