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
