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


## [2026-06-16] Task T3 — captureUpdate contract (SPIKE COMPLETE)

### Verdict
**Use `captureUpdate` API.** No custom undo grouping needed at canvas-store
layer. Full report: `.sisyphus/spikes/03-captureUpdate.md`.

### Enum contract (Excalidraw 0.18.1)
- Import: `import { CaptureUpdateAction } from '@excalidraw/excalidraw'`
  (runtime value, publicly re-exported at
  `dist/types/excalidraw/index.d.ts` L23).
- Three values, wire strings = symbol names:
  - `IMMEDIATELY` → `store.captureIncrement()` → ONE new undo entry.
  - `NEVER` → `store.updateSnapshot()` → snapshot silently advances, NO entry.
  - `EVENTUALLY` → gated out at `App.updateScene` L25935 → no store
    interaction at all; deferred to next `IMMEDIATELY`.
- **Foot-gun:** an absent / `undefined` `captureUpdate` field is treated
  exactly like `EVENTUALLY` (gated out). Wave 4 code must always pass an
  explicit value. Lint rule candidate.
- `SceneData` field declared at
  `dist/types/excalidraw/types.d.ts` L464-469 as
  `captureUpdate?: CaptureUpdateActionType`.

### Coalescing pattern for T17
`N-1` calls with `NEVER` + 1 final call with `IMMEDIATELY` collapses
the whole batch into a single undo step. Batch of size 1 = just
`IMMEDIATELY`. Batch of size 0 = no `updateScene` call at all.

### Interleaving edge case (informs T22)
If a user `IMMEDIATELY` lands between an in-flight batch's `NEVER`s and
its final flush, elements absorbed by the prior `NEVER`s are baked into
the snapshot baseline and become un-undoable (per Excalidraw's documented
"never recorded" semantics). T22 must enforce mutual exclusion (lock the
canvas while a batch is in flight). Fallback: switch intermediates from
`NEVER` to `EVENTUALLY` — no silent loss but the batch fragments into
multiple undo entries. Recommended primary = lock; secondary = feature-
flagged fragmentation. Full table in
`.sisyphus/evidence/task-3-interleaving.txt`.

### Jan's current usage (snapshot)
- Zero call sites of `captureUpdate` or `updateScene` in `web-app/src`.
- Three docstring-only mentions: `CanvasEditor.tsx:66`, `types/canvas.ts:31`,
  `stores/canvas-store.ts:57`. All are comments documenting the future
  contract, not actual function calls.
- `useCanvasAutoSave.ts` exists but does not touch `updateScene` either —
  it reads via Excalidraw's `onChange` callback and writes to the store.

### Imperative API caveat
`ExcalidrawImperativeAPI.history` only exposes `clear` (`dist/types/excalidraw/types.d.ts`
L608-610). There is NO public `undo()` / `redo()` method. QA for T17/T22
must trigger undo via keyboard events (`Ctrl/Cmd+Z`) or via
`registerAction(...)`. Document this when writing the Playwright tests.

## [2026-06-16] Task T4: First-spawn latency measurement

### Cold-spawn numbers (5 runs each, bun/node killed between, 800ms settle)

- **Direct-stdio path (Jan-representative)**: mean 381.8 ms, stdev 8.3 ms (2.2% of mean), min 375, max 398.
- **Inspector CLI wrapper (upper bound)**: mean 7546.4 ms, stdev 238.6 ms (3.2%), min 7366, max 8010.
- Inspector wrapper adds ~7.2s of Node + Inspector CLI startup — NOT what Jan pays. Use the 382 ms number for production sizing.
- Numbers are warm-OS-cache. Cold-OS-cache (post-reboot, anti-virus scan) likely 700-1000 ms; treat 382 ms as best case.

### Latency budget for T19 (CanvasAiIndicator)

- Cold spawn (mean 382 ms) is < 800 ms plan threshold but > 300 ms "indicator-can-defer-150ms" threshold.
- **Decision**: indicator MUST appear within ≤ 200 ms of send-button click on the FIRST tool call per Jan session. Auto-hide on first tool resolution.
- For subsequent tool calls in the same session (persistent stdio, no respawn), defer indicator to 150 ms of pending state.
- 200 ms budget is conservative — handles real-world cold-OS-cache + AV scan scenarios that we couldn't measure.

### Tool count anomaly (resolved)

- runs.txt reports 30 tools — this is a "name"-substring counting artifact. The script counted every "name" in the tools/list JSON, which matches both tool.name AND inputSchema.properties.<param>.name fields.
- True tool count parsed via ConvertFrom-Json from .result.tools.length = **26**, matches T2 and the plan.
- **T8 allow-list count = 26 tools**, not 30. First 5 verified: create_element, update_element, delete_element, query_elements, get_resource.

### Methodology notes (for future spikes)

- Don't trust Select-String '"name"' | Measure-Object for counting tools — always parse the JSON. Substring matches inflate counts because parameter schemas reuse the "name" key.
- When measuring MCP spawn latency, the Inspector CLI is a convenient client but adds 7s of Node startup. For numbers that map to production, pipe raw JSON-RPC frames over stdin and time spawn → response.
- 5 runs with stdev < 5% of mean is plenty for a spike — no need for more samples unless variance is high.


## T7 — CanvasMcpOrchestrator contract types (Wave 2)

**Date:** 2026-06-16
**Files:**
- `web-app/src/lib/canvas-mcp-orchestrator/types.ts` — types-only module
- `web-app/src/lib/canvas-mcp-orchestrator/types.test.ts` — 12 vitest tests, all green

### Canonical contract shape
- `OrchestratorRequest` = `{ canvasId, prompt, threadId, modelId }` — all `string`.
- `OrchestratorState` = exactly 5 literals: `'idle' | 'spawning' | 'awaiting-approval' | 'drawing' | 'error'`.
- `McpToolCall` = `{ name: string, arguments: Record<string, unknown> }`.
- `McpToolResult` = **discriminated union**:
  - success: `{ content: Array<{ type: 'text', text: string }> }`
  - error:   `{ error: string }`
  - Structurally compatible with Jan-core `MCPToolCallResult` (which is the flat `{ error, content }` shape). Adapter at boundary maps between the two.
- `ElementIdMapping` = `Map<string /* mcp id */, string /* canvas-store id */>`.
- `OrchestratorResponsibility` is a runtime `const` (not enum) with 11 entries → keys are method names, values are short verbatim summaries from plan.
- `OrchestratorResponsibilityName` = `keyof typeof OrchestratorResponsibility` (machine-checkable name union).
- `Telemetry` = `{ spawnDurationMs?, toolCallCount, batchSize, approvalCount, errors }` — only `spawnDurationMs` optional.

### The 11 responsibilities (verbatim, in canonical order)
1. `resolveActiveCanvas` — active-canvas resolution
2. `dispatchToolCall` — gated dispatch
3. `translateElementId` — ID translation
4. `syncStateFromCanvas` — push canvas-store state into mcp_excalidraw at session start
5. `beginAiBatch` — undo grouping start (returns token used by endAiBatch)
6. `endAiBatch` — commits one history entry via captureUpdate
7. `handleProcessCrash` — orchestrate restart + state replay
8. `translateToolResult` — MCP → canvas-store mutations
9. `applyTheme` — apply Jan theme defaults
10. `lockManualEdits` — concurrency control
11. `enforceCuratedToolList` — wraps `filterAllowedTools` from T8

### Gotchas / decisions
- Used `export const OrchestratorResponsibility = {...} as const` instead of a TS `enum` — gives both runtime introspection (`Object.keys(...).length === 11`) and a type via `keyof typeof`, with zero extra runtime cost and no enum-emit surprises.
- Did NOT import from `@janhq/core` in `types.ts` itself (kept types fully standalone for future server-swap); only `types.test.ts` imports `MCPToolCallResult` to assert structural compatibility.
- Test runner = vitest, NOT `bun test` directly. Use `bun run test -- <path>` so the cross-env wrapper invokes vitest. `bun test` directly fails on `expectTypeOf().toHaveProperty().toEqualTypeOf()` chaining (Bun's bundled jest-compatible runner does not implement the full vitest type-assertion API).

## T5 — Vendoring lessons (2026-06-16)

- **Gitignore "parent directory excluded" trap**: `src-tauri/resources/` (line 66) was
  ignoring the entire vendored snapshot. Negations like `!src-tauri/resources/mcp_excalidraw/**`
  CANNOT re-include files whose parent directory is excluded by a trailing-slash pattern.
  Per git docs: *"It is not possible to re-include a file if a parent directory of that file is excluded."*
  Fix: replaced the blanket rule with explicit subpath ignores (`src-tauri/resources/lib`;
  bin/pre-install/icons were already explicitly listed earlier in the file).
- **Upstream's own .gitignore**: `src-tauri/resources/mcp_excalidraw/.gitignore` (vendored
  as-is from upstream) excludes `dist/`, `node_modules/`, `*.log`, `.env`, `public/dist/`,
  etc. Use `git add -f <path>` to override for files we explicitly need (notably `dist/`).
- **Build-time stats**: `npm ci` + `npm run build` against pinned SHA on this Windows host:
  - `npm ci`: pulls hundreds of MB of node_modules (29 vulnerabilities reported by npm audit;
    those live in devDeps and are out of scope for vendoring per the security review path).
  - `npm run build`: ~34s, produces `dist/index.js` (95755 bytes), MCP banner clean on
    bun spawn.
- **Smoke test pattern that works**: `bun dist/index.js --help` exits 0 on this SHA (the
  server treats unknown flags as no-op + exits clean). For a stronger check use spawn-then-kill
  after a couple of seconds — the PowerShell `ProcessStartInfo` pattern is captured in
  `.sisyphus/evidence/task-5-vendor-smoke.txt`.
- **Vendor commit hygiene reminder**: working tree had ~30 files of unrelated noise
  (autogenerated plugin permissions, `Cargo.lock`, plan checkbox edit). Used explicit
  `git add <paths>` to keep them out — `git add .` / `git add -A` was strictly forbidden.
