# Decisions â€” canvas-llm-dispatch

<!-- Append only. Never overwrite. Format: ## [TIMESTAMP] Task: {task-id} -->

## [2026-06-17] Task: T2

### useChat API surface
- `useChat` (from `@/hooks/use-chat`) wraps `@ai-sdk/react`'s `useChatSDK` and returns its full result spread plus `updateRagToolsAvailability` and `setContinueFromContent`.
- SDK `status` values: `'submitted' | 'streaming' | 'ready' | 'error'` â€” mapped to canvas-facing `'submitting' | 'streaming' | 'idle' | 'error'`.
- `sendMessage` accepts `{ role, parts }` object (UIMessage shape) OR plain string; we pass the parts-object form for explicitness.
- `useChat` accepts `sessionId`, `systemMessage`, `onFinish` in its options â€” all used by `useCanvasChat`.

### Transport stabilization approach
- `useChat` owns the `transportRef` internally â€” it already does NOT recreate transport on re-render.
- `useCanvasChat` does NOT need its own `transportRef`; simply passing a stable `sessionId` is sufficient to get session-persisted transport reuse via `useChatSessions` store.
- Tool definitions stabilized via `toolDefsRef` (computed once on first render, never recreated).

### Tool definition shape
- `getExcalidrawCuratedToolDefinitions()` added to `curated-tools.ts` â€” returns `Record<string, Tool>` using `jsonSchema({ type: 'object', additionalProperties: true })` stubs.
- Derives exclusively from `EXCALIDRAW_ALLOWED_TOOLS` â€” no separate hardcoded list.
- Descriptions are placeholders (`mcp_excalidraw tool: <name>`); real schemas come from live `tools/list` at runtime.
- Note: `useCanvasChat` currently does NOT pass this tool record to `useChat` â€” the transport handles tool loading from MCP. The function exists for future use by T6/orchestrator wiring.

### Minimal API surface decision
- Returned: `{ sendMessage, stop, status, error }` â€” no `messages`, no `addToolOutput`, no RAG methods.
- `onToolCall` / `onFinish` forwarded via stable refs to avoid re-creating `useChat` options on every render.
- `CANVAS_SYSTEM_PROMPT` defined as a named const at file top per spec.

### Session ID collision prevention
- `sessionId: 'canvas-' + canvasId` â€” prefix ensures canvas sessions never collide with chat thread sessions (which use raw `threadId`).

### Test approach
- Vitest + `@testing-library/react` `renderHook`.
- `useChat` mocked at module level via `vi.mock('@/hooks/use-chat')` â€” `vi.mocked(useChat)` used to introspect call args (avoids `require()` inside test body which bypasses Vitest module registry).
- 12 tests, all passing.

## [2026-06-17] Task: T1 — Wire orchestrator deps in canvas route

### Wiring approach chosen

**Router:** useRouter() from @tanstack/react-router added to the CanvasDetail component. The hook returns a stable object matching RouterLike = { state: { matches: [...] } }. No import existed in any canvas route before — added to the existing @tanstack/react-router import statement.

**mcpClient adapter:** MCPService.callTool({ toolName, serverName?, arguments }) differs from McpClientLike.callTool({ name, arguments }). Thin adapter created inline via useMemo([serviceHub]):
`	s
callTool: (call: McpToolCall) =>
  serviceHub.mcp().callTool({ toolName: call.name, arguments: call.arguments })
    .then(result => result as McpToolResult)
`
useServiceHub() returns a stable zustand singleton, so mcpClient identity is stable across renders.

**canvasStore:** Passed as useCanvasStore (the zustand hook itself, typed unknown at the deps slot). The orchestrator's syncStateFromCanvas (T14) will narrow it to CanvasStoreLike at the call site.

**excalidrawAPI (late binding):** No setExcalidrawAPI() method exists on the orchestrator. The BatchController stores the API at construction time from deps.excalidrawAPI. Since ExcalidrawImperativeAPI is unavailable on first render (Excalidraw mounts async), we:
1. Pass no excalidrawAPI at construction (batch ops are fail-closed no-ops until set — documented in batch.ts)
2. Use useEffect(() => { if (apiRef.current) { (orchestrator as …).deps.excalidrawAPI = api } }) with no deps array to sync the ref after every render
   - deps is protected readonly at TypeScript level but unknown-typed at runtime — cast bypasses compile-time check safely
   - No deps array ensures the ref is always current once Excalidraw mounts

**Memoization stability:** useMemo([canvas.id, mcpClient]) — only recreates when canvas changes (intentional new session) or if mcpClient identity changes (practically never, serviceHub is singleton). Router is intentionally excluded from deps (stable object, not a React state value).

### Gotchas encountered

1. useRouter was not previously used in any route in the project — no existing pattern to copy from. Added straightforwardly per TanStack Router docs.
2. Vitest test for "does NOT recreate orchestrator on re-render" initially failed because the useServiceHub mock returned a new object per call, making mcpClient useMemo recompute. Fixed by making the mock return a module-level stable reference (mirrors the real zustand singleton behavior).
3. 	sc -b --noEmit showed 5 pre-existing errors in unrelated files (JSX namespace in CanvasAiIndicator/CanvasManualEditLockBanner, DialogService type in MasterPromptInput). Zero new errors from this task's changes.
