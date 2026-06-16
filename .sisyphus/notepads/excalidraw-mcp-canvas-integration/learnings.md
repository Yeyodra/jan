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



## [2026-06-16] T1.5 — Dispatcher canvas-route wiring landed

**Files touched (exactly):**
- `web-app/src/routes/threads/$threadId.tsx` (modified — 3 hunks)
- `web-app/src/lib/canvas/dispatch.ts` (new — ~80 lines, pure helper)
- `web-app/src/lib/canvas/dispatch.test.ts` (new — 11 vitest cases)
- `tests/manual/t18-tools-verification.md` (appended §8 only — original preserved)
- `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` (added T1.5 note under Task 1)

### Dispatcher routing pattern (after T1.5)

The thread-route dispatcher at `$threadId.tsx:357-378` now has three branches plus a fallback. Each branch has a different shape:

| Branch | Predicate | Resolution | Approval default |
|---|---|---|---|
| RAG | `ragToolNames.has(toolName)` | `serviceHub.rag().callTool({toolName, arguments, threadId, projectId, scope})` | auto-approved (built-in) |
| Canvas (T18) | `canvasToolNames.has(toolName)` | `dispatchCanvasTool(toolName, toolCall.input)` — in-process helper | auto-approved IFF read-only; mutating set still gated |
| MCP (remote) | `mcpToolNames.has(toolName)` | `serviceHub.mcp().callTool({toolName, arguments})` | gated through `requestApproval` |
| Fallback | — | `{ error: "Tool '…' not found in any service", content: [] }` (added `content: []` so the TS type stays an `MCPToolCallResult`) | n/a |

### MCPToolCallResult envelope shape (canonical reference)

From `core/src/types/mcp/mcpEntity.ts:12-18`:

```ts
{ error: string; content: Array<{ type?: string; text: string }> }
```

The downstream consumer in `$threadId.tsx` reads `result.error` (string truthiness check) and `result.content` (passed straight to `addToolOutput({output: ...})`). So the canvas dispatcher MUST always produce both fields — never `error: ''` with `content: undefined` and never just `{ error }` without `content`. The fallback branch needed `content: []` added for this reason.

### Approval-gate predicate (canonical reference)

```ts
const isAutoApproved =
  ragToolNames.has(toolName) ||
  (canvasToolNames.has(toolName) && !mutatingToolNames.has(toolName))
```

Two key invariants enforced by `dispatch.test.ts`:
- `mutatingToolNames` MUST equal `{canvas_create, canvas_update, canvas_delete}` (no more, no fewer). Drift detector in the test suite.
- `canvas_list` and `canvas_read` are the ONLY canvas tools that bypass the modal.

### Helper-extraction (Option A) decision

Extracted `dispatchCanvasTool` into its own pure module. Rationale: testable without standing up jsdom + zustand + the entire route tree, AND keeps `$threadId.tsx` import surface small. The optional `deps.byName` parameter exists ONLY for tests — production code never passes it. Pattern: `(deps.byName ?? canvasBuiltinToolsByName).get(toolName)`.

### Test wiring tips

- For canvas-store-backed tests, mock `idb-keyval` (the persist middleware imports it eagerly under jsdom — without the mock it throws on missing IndexedDB). Pattern lifted from `ai-tools.test.ts` lines 30-39.
- Reset the store with `useCanvasStore.setState({ canvases: {} })` in `beforeEach` (NOT with `replace=true` — that strips middleware-injected state).
- `bun test` doesn't pick up vitest's jsdom config — `bun test src/hooks/__tests__/useTools.test.ts` fails with `ReferenceError: document is not defined`. Use `npx vitest --run <path>` for anything that touches React/testing-library. `bun test` is fine for pure modules like `dispatch.test.ts` and `ai-tools.test.ts`.


## [2026-06-16] Task T2: bun runtime spike (PASS-WITH-CAVEATS)

### Confirmed facts
- **bun 1.3.14** cleanly runs Node-built `dist/index.js` of mcp_excalidraw at SHA `c12ff87f6d607ccac7b217ae415bee8d855a067e` over MCP stdio.
- `tools/list` returns **26 tools** (matches plan acceptance). Buckets all present per README: Element CRUD, Layout, Scene Awareness, File I/O, State, Viewport, Design Guide, Resources.
- Hard-exclude targets confirmed in surfaced list: `export_to_image` (#18), `get_canvas_screenshot` (#23). T8 exclude list = these two → 24 surfaced after projection.
- Boot is **silent on stderr** under `ENABLE_CANVAS_SYNC=false`. Production env contract: this flag must be set when spawning via `src-tauri/src/core/mcp/helpers.rs:570-610`.
- Wall-clock: cold ~40s (dominated by `npx --yes @modelcontextprotocol/inspector` package fetch); warm ~5s. mcp_excalidraw startup itself is sub-second.
- Build: `npm ci` 566 pkgs / ~23s; `npm run build` = vite frontend (2007 modules) + tsc server, both clean. `dist/index.js` = 95755 bytes.

### Caveats
- npm warns during cold `npx` fetch: `inflight@1.0.6`, `glob@7.2.3`, `node-domexception@1.0.0`. All from MCP Inspector transitive deps, not mcp_excalidraw. Disappear on warm runs.
- 29 npm-audit vulnerabilities reported on `npm ci` (mcp_excalidraw deps). Informational; upstream concern. Not blocking spike.
- Negative test: `export_to_image` and `get_canvas_screenshot` did **NOT hang** under `ENABLE_CANVAS_SYNC=false` with no Express server — both error quickly with `"Error: Unable to connect"` and `isError: true` (~5-6s). Hard-exclude rationale still holds (broken tools, polluted tool registry, hang risk under different env flags) but the QA hang prediction was not reproduced.

### Unblocks
- **T5** (vendor mcp_excalidraw) — bun-runs-it confirmed; vendor at same SHA.
- **T8** (registry projection) — exclude list = `["export_to_image", "get_canvas_screenshot"]`.

### Evidence
- `.sisyphus/spikes/02-bun-runtime.md` (full report)
- `.sisyphus/evidence/task-2-bun-tools-list.json` (raw tools/list response)
- `.sisyphus/evidence/task-2-export-to-image-hangs.txt` (negative test)
