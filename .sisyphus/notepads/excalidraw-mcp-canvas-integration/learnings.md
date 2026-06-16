# Learnings — excalidraw-mcp-canvas-integration

## [2026-06-16] Repo State at Session Start (fresh clone)
- **Working dir**: `C:\Users\Nazril\Documents\Projek\jan` (fresh clone)
- **Remote**: `https://github.com/Yeyodra/jan.git`
- **Branch**: Created `feat/excalidraw-mcp` from `main`
- **Base commit**: `f885f8086` (merge of feat/compare-feature into main)
- **Pre-Plan Checklist (Steps 0a-0d)**: SKIPPED — already merged via PRs:
  - PR #1: `308d8a9fa` feat(compare): multi-model side-by-side chat with attachments
  - PR #2: `924522058` feat(canvas): standalone Excalidraw whiteboard with multi-canvas library, AI tools, and thumbnails
- **T18 wiring landed differently**: plan asserts wiring via `hooks/use-chat.ts` + `routes/threads/$threadId.tsx`, but actual wiring is via `hooks/useAppState.ts` (canvasToolNames Set) + `hooks/useTools.ts` (imports canvasBuiltinTools). Functionally equivalent — plan reference is stale, real code works.

## Architecture Facts (confirmed)
- `web-app/src/lib/canvas/ai-tools.ts` exports:
  - `CANVAS_TOOL_SERVER = 'canvas'`
  - `canvasBuiltinTools` (readonly array)
  - `canvasBuiltinToolsByName` (ReadonlyMap)
  - `mutatingToolNames` (Set: canvas_create, canvas_update, canvas_delete)
  - 5 tools total: canvas_list, canvas_read, canvas_create, canvas_update, canvas_delete
- `web-app/src/stores/canvas-store.ts` — canvas state store (zustand)
- `web-app/src/routes/canvas/` — already has `index.tsx` and `$canvasId.tsx`

## [2026-06-16] Task T1: T18 end-to-end verification

### Architecture facts confirmed (Layers 1 & 2)
- ai-tools.ts: 5 tools, mutatingToolNames = {canvas_create, canvas_update, canvas_delete}, CANVAS_LIST_LIMIT = 50, CANVAS_TOOL_SERVER = 'canvas'.
- useTools.ts strips `handler` field when projecting CanvasBuiltinTool -> MCPTool (intentional; dispatcher is supposed to re-resolve via canvasBuiltinToolsByName).
- useTools.ts has a defensive shadow-check: if a remote MCP tool collides with a canvas name, the canvas tool is dropped + a console.warn fires.
- canvasToolNames Set lives on useAppState (slot at L24, setter L52/L134).
- Vitest src/lib/canvas/ai-tools.test.ts: 19/19 PASS, 125 expect() calls, ~656ms.

### Dispatcher path (the actual one)
- The ONLY MCP tool-call dispatch site is web-app/src/routes/threads/$threadId.tsx (lines 313-366), inside the streaming response handler.
- It branches on ragToolNames + mcpToolNames only. No canvas branch.
- requestApproval gate at L328-332 only auto-approves ragToolNames; does not consult mutatingToolNames.

### MCPToolCallResult shape (core/src/types/mcp/mcpEntity.ts:12-18)
- `{ error: string; content: Array<{type?: string; text: string}> }`
- T18 handlers return raw objects; any future canvas branch must marshal into this envelope (e.g. `content: [{type:'text', text: JSON.stringify(result)}]`).

### Environment probe
- src-tauri/target/debug/Jan.exe exists (60 MB, debug build, 2026-06-16 22:31).
- Local model: Jan-v3.5-4B-Q4_K_XL (~3 GB) under llamacpp/models.
- No remote provider with API key configured.
- MCP servers configured but mostly inactive (only `exa` is active).

