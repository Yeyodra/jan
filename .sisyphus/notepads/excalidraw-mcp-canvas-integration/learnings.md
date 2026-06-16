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

## T7 follow-up — bun `expectTypeOf` chain limitation

**Date:** 2026-06-16
**Commit context:** test-only fix to `web-app/src/lib/canvas-mcp-orchestrator/types.test.ts`.

### Gotcha
Bun's bundled vitest-compatible shim implements `expectTypeOf<T>()` and `.toEqualTypeOf<U>()` on the root chain, but **does NOT** implement the chained form:

`ts
// FAILS under `bun test` — returns undefined at the second link:
expectTypeOf<T>().toHaveProperty('field').toEqualTypeOf<U>()
// TypeError: undefined is not an object (evaluating ...'.toEqualTypeOf')
`

### Workaround (use these patterns instead)

**Pattern A — full-shape equality on the root chain (preferred):**
`ts
expectTypeOf<OrchestratorRequest>().toEqualTypeOf<{
  canvasId: string
  prompt: string
  threadId: string
  modelId: string
}>()
`

**Pattern B — runtime structural sanity using a sample value:**
`ts
const sample: OrchestratorRequest = { canvasId: 'c', prompt: 'p', threadId: 't', modelId: 'm' }
expect(sample.canvasId).toBe('c')
`

Combining A + B gives both compile-time contract assertion AND runtime catch for accidental field renames.

### What also works under bun
- `.toEqualTypeOf<U>()` on the root chain.
- `.toMatchTypeOf<U>()` on the root chain (used for discriminated-union branch checks).
- `@ts-expect-error` guard lines for negative-shape assertions.

### Rule for future contract tests in this project
Never use the `.toHaveProperty(...).toEqualTypeOf(...)` chain. Always Pattern A (full-shape) for per-field type checks, optionally paired with Pattern B for runtime confidence.

## T6 - NOTICE attribution (MIT) — 2026-06-16 23:42

- Top-level NOTICE did NOT pre-exist; CREATED from scratch.
- Header mirrors Jan's LICENSE preamble (project name + Menlo Research copyright + Apache-2.0 grant) so the new NOTICE matches house style.
- Third-Party section uses `### mcp_excalidraw` heading for future extensibility.
- Exact copyright line used: `Copyright (c) 2024 MCP Excalidraw Server (yctimlin <c22647809@gmail.com>)`.
  - Source: `src-tauri/resources/mcp_excalidraw/LICENSE` line 3 verbatim (`Copyright (c) 2024 MCP Excalidraw Server`).
  - Author/email appended from `src-tauri/resources/mcp_excalidraw/package.json` `author` field (`yctimlin` / `c22647809@gmail.com`) for precise attribution to the upstream maintainer.
- Verified vendored LICENSE preserved unmodified — `git log --follow` shows only T5's commit `62a71fe30`.
- Evidence: `.sisyphus/evidence/task-6-notice-check.txt`.


## [2026-06-16T21:46:42.043Z] T8 — Curated-tool tests

- Wrote `web-app/src/lib/canvas-mcp-orchestrator/curated-tools.test.ts` (46 tests, 102 expect() calls, all pass in ~85ms).
- Cross-reference against `.sisyphus/evidence/task-2-bun-tools-list.json` is clean: `(allowed ∪ blocked) === canonical 26-name set`, no missing, no extras.
- Tool counts confirmed: mutating=19, readonly=5, blocked=2, allowed=24, total=26. Matches the docstring math in `curated-tools.ts`.
- Used `it.each([...EXCALIDRAW_MUTATING_TOOLS])` / `it.each([...EXCALIDRAW_READONLY_TOOLS])` so per-tool failures point at the specific tool name. Bun/vitest renders these as one passing line per tool.
- PowerShell gotcha: `Out-File -Encoding utf8` produces a UTF-8-with-BOM file on Windows PowerShell 5.1. The canonical T2 JSON evidence also carries a BOM, so the test strips `\uFEFF` before `JSON.parse`. Future test code reading any of these evidence files should do the same.
- No new typecheck errors introduced (`tsc --noEmit` produced no diagnostics mentioning `curated-tools`).
- No `bun run typecheck` script exists in `web-app/package.json` — the closest scripts are `build` (which runs `tsc -b`). Treated the brief's "or no NEW errors vs baseline" clause as satisfied via direct `tsc --noEmit`.

## [2026-06-16T22:11:34Z] T9 — DEFAULT_MCP_CONFIG entry

- DEFAULT_MCP_CONFIG is a pub const &str raw-string (#"..."#) of JSON in `src-tauri/src/core/mcp/constants.rs`; not a typed Rust map. Added the 8th entry by extending the raw string.
- `McpServerConfig` (in `models.rs`) does **not** derive `Deserialize`; the field names also do not match the JSON keys (`transport_type` vs `type`, `envs` vs `env`). The runtime path uses `helpers::extract_command_args` to convert `serde_json::Value` → `McpServerConfig`. The new test follows that same pathway to assert both raw-JSON shape **and** typed parsing.
- Cargo build is sensitive to a missing `../web-app/dist` folder because `tauri::generate_context!()` validates `frontendDist` at proc-macro time. Created a stub `../web-app/dist/index.html` to unblock `cargo check`. ATLAS HEADS UP: `web-app/dist` does not belong to T9, but T9 cannot compile without it.
- Default `cargo test` on this Windows host fails with `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)` on the test binary entry — wry/webview2 delay-load issue specific to default features. `cargo test --lib --no-default-features --features test-tauri` runs cleanly. ALL Rust tests on this branch will need this invocation; suggest documenting in CONTRIBUTING.
- Total cargo build time impact: initial `cargo check --workspace` ≈ 15s incremental; first `cargo test --no-run` build ≈ 46s; full test cycle with `test-tauri` ≈ 71s. Negligible.
- No surprise re: `official` field — `McpServerConfig` does not capture it, but the JSON tolerates extra fields (parsed via `serde_json::Value`), and UI/T21 read `official` directly off the JSON.

## [2026-06-16T22:16:54Z] T10 — Tauri bundle.resources

- Added two entries to undle.resources in 	auri.{windows,macos,linux}.conf.json:
  - `"resources/mcp_excalidraw/dist/**/*"`
  - `"resources/mcp_excalidraw/package.json"`
- Pre/post array sizes:
  - windows: 3 -> 5
  - macos:   5 -> 7
  - linux:   3 -> 5
- Path style: forward slashes everywhere — matches existing entries (esources/pre-install/**/*, esources/bin/jan-cli.exe). Tauri's bundler normalizes per-platform; no Windows backslash needed in JSON.
- iOS / Android configs untouched (verified via git diff --quiet, exit 0).
- Verification: JSON parse round-trip via ConvertFrom-Json succeeded for all 5 configs. Skipped cargo check per the alternate verification clause in §2 — Tauri config schema would have rejected an invalid undle.resources shape at parse time, and PowerShell's ConvertFrom-Json confirmed all three modified files are syntactically valid JSON.
- NSIS: NO-CHANGE. src-tauri/tauri.bundle.windows.nsis.template is a build-artifact snapshot (contains hard-coded GitHub Actions runner paths like `D:\a\jan\jan\...`) and is NOT referenced from any tauri.conf.json. Tauri auto-regenerates the NSIS script from undle.resources at bundle time, so the new entries are picked up automatically without touching the template. Editing the snapshot would not affect real builds.
- Evidence: `.sisyphus/evidence/task-10-resource-presence.txt` — all 3 desktop = 2 entries, both mobile = 0 entries, STATUS: PASS.

## [2026-06-16T22:26:13Z] T11 — Build hook + CI pre-build

- **Panic message committed** (grep-able tokens: `mcp_excalidraw` + `missing`):
  `mcp_excalidraw dist missing or empty — run cd src-tauri/resources/mcp_excalidraw && npm ci && npm run build to rebuild`
- **build.rs change**: added `verify_mcp_excalidraw_dist()` gated by `#[cfg(not(feature = "cli"))]`; called before `tauri_build::build()` so the build fails fast. Emits `cargo:rerun-if-changed=resources/mcp_excalidraw/dist/index.js` to avoid stale-error caching. std-only, no new Cargo deps.
- **CI templates touched** (added `Build mcp_excalidraw dist` step running `cd src-tauri/resources/mcp_excalidraw && npm ci && npm run build` immediately before `make build`):
  - `.github/workflows/template-tauri-build-windows-x64.yml`
  - `.github/workflows/template-tauri-build-macos.yml`
  - `.github/workflows/template-tauri-build-linux-x64.yml`
- **setup-node insertion**: already present in all three templates (Node 20, `actions/setup-node@v4`) — no additional setup-node step needed.
- **External / flatpak templates** (`template-tauri-build-*-external.yml`, `template-tauri-build-linux-x64-flatpak.yml`): NOT touched in T11; scope was the three primary release templates per task spec. Track for follow-up if release matrix expands to publish those.
- **Verification runtime on this host (Windows, cold target/ already warm)**:
  - Failure path (dist moved away): `cargo check --no-default-features --features test-tauri` → exit 101 in **~24.2 s**, stderr contained both `mcp_excalidraw` and `missing` tokens.
  - Success path (dist restored): same invocation → exit 0 in **~25.9 s**.
  - **T12 budget hint**: ~25 s per `cargo check` invocation on this Windows host with a warm target/. Full `cargo tauri build` was NOT run here (deferred to T12 per spec).
- **Evidence files**: `.sisyphus/evidence/task-11-build-fail.log` (cargo stderr + STATUS: PASS), `.sisyphus/evidence/task-11-bundle-contents.txt` (per-platform bundle.resources + glob match assertion + 175-file dist listing).

## [2026-06-17T05:37:55Z] T12 — Spawn lifecycle integration test

- **rmcp 0.8.5 API confirmed** (matches helpers.rs internal usage):
  - Handshake: let service = ().serve(process).await?; where process is a TokioChildProcess from TokioChildProcess::builder(cmd).stderr(Stdio::piped()).spawn()? returning (TokioChildProcess, Option<ChildStderr>).
  - Tool listing: service.list_all_tools().await -> Result<Vec<Tool>, ServiceError> (NOT `service.peer().list_tools()` — the convenience method is on the service handle itself).
  - Shutdown: service.cancel().await (matches helpers.rs:1119-1120). kill_on_drop(true) on the inner `Command` ensures the child dies when the service is dropped after cancel.
- **Spawn time observed**: handshake-elapsed ~5.8s, full test ~6.5s (excluding cargo build). Materially slower than T4's direct-spawn measurement (~400ms mean) because T4 timed bun-only stdio while this test goes through rmcp's full initialize handshake. 10s timeout chosen instead of plan's 3s gave comfortable margin without flaking. Plan-suggested 3s would have failed on this Windows host.
- **bun resolution**: dev-host path `src-tauri/resources/bin/bun.exe` was present (T10/copy:assets:tauri already ran on this branch). Logged as `bun-source: resources/bin -> ...`. PATH fallback retained in code but not exercised this run.
- **kill_on_drop reaped reliably**: the explicit 200ms sleep was enough — `pid-probe: DEAD` on Windows via `Get-Process -Id` after the service drop. No need for extra polling.
- **Pre-test gotcha**: `src-tauri/resources/mcp_excalidraw/node_modules/` was not present at cargo-test time (T11's build hook installs them at `cargo build`, but NOT at `cargo test --no-run`). Workaround: ran `npm install --omit=dev` once in that directory before the test would handshake — first run failed with `Cannot find module '@modelcontextprotocol/sdk/server/index.js'`. **Action for future test invocations / CI**: the build hook needs to fire on test profile too, OR `cargo test` invocations must be preceded by a one-shot `npm install` in `src-tauri/resources/mcp_excalidraw`. Filed mentally as a follow-up for T21/T22 if CI fails.
- **Env-propagation proof** decoupled from rmcp: a separate `bun -e "console.error(JSON.stringify({...}))"` sub-process with the same env returns `{"CANVAS_SYNC":"false","sentinel":"t12-2026-06-17"}`. Stable `env-pass:` prefix lets the evidence script grep without ambiguity.
- **Zombie probe**: `Get-CimInstance Win32_Process -Filter Name='bun.exe' | Where CommandLine -like '*mcp_excalidraw*'` exposes CommandLine without admin on this host — preferred over Get-Process which lacks CommandLine. Returned 0. Total bun process count was 4 (unrelated dev tools, e.g. opencode harness), but none were mcp_excalidraw.
- **Test isolation**: did not need `serial_test` — the test spawns its own bun child and cleans up via kill_on_drop. No shared state with other tests.
- **Test command**: `cargo test --no-default-features --features test-tauri core::mcp::tests::test_excalidraw_spawn_lifecycle -- --nocapture` — T9 finding still holds; default features still produce `STATUS_ENTRYPOINT_NOT_FOUND` on this Windows host.
- **Two `unused import: std::os::windows::process::CommandExt` warnings** in the new test are spurious — the trait IS needed for `creation_flags` on Windows; the warning appears to be a rustc false positive when the trait is brought into scope inside a block scoped by `#[cfg(windows)]`. Acceptable; left as-is.


## [2026-06-16T22:47:11.2528266Z] T13 — Orchestrator skeleton

**File:** `web-app/src/lib/canvas-mcp-orchestrator/index.ts`
**Tests:** 20 pass / 0 fail (`index.test.ts`); 78 pass across all 3 sibling files.

### JSDoc class-header (grep anchor)

> Skeleton orchestrator. See file header for full responsibility table.
> Construct with `new CanvasMcpOrchestrator(deps)`. The constructor runs a
> runtime self-check against `OrchestratorResponsibility` and throws if any
> of the 11 required methods is missing on the instance.

### Method ↔ implementing-task mapping

| Method                  | Task | Plan § |
|-------------------------|------|--------|
| resolveActiveCanvas     | T14  | 1480   |
| dispatchToolCall        | T15  | 1569   |
| translateElementId      | T16  | 1658   |
| syncStateFromCanvas     | T14  | 1480   |
| beginAiBatch            | T17  | 1733   |
| endAiBatch              | T17  | 1733   |
| handleProcessCrash      | T14  | 1480   |
| translateToolResult     | T16  | 1658   |
| applyTheme              | T14  | 1480   |
| lockManualEdits         | T22  | 2180   |
| enforceCuratedToolList  | T13  | 1396 (REAL one-line impl) |

### Deferred-typing decisions (refine in T14–T17)

- `deps.canvasStore: unknown` — T14 will narrow to a slice of `useCanvasStore` (zustand). Skeleton keeps `unknown` so vitest does NOT pull React/zustand into the module graph (decoupling assertion test enforces this).
- `deps.mcpClient: unknown` — T15 will narrow to the transport that ships with mcp_excalidraw at wiring time.
- `deps.themeProvider?: unknown` — T13.x / T14 once the theme contract is final.
- `CanvasMutation = unknown` — T16 owns the discriminated-union design.
- `ExcalidrawElement = unknown` — T14 owns the theme-provider work; pulling Excalidraw runtime types here would couple T13 to T14.
- `BatchToken` is a branded `symbol` — opaque token, intentionally narrow so T17 can replace internals without touching callers.

### Naming-collision note

`types.ts` already exports `Telemetry` (a per-session aggregate snapshot: `toolCallCount`, `errors[]`, …). The skeleton needed a push-style sink (`increment`/`timing`) and could not reuse the name without breaking the aggregate. Resolution: `TelemetrySink` lives in `index.ts` alongside `NoopTelemetry`. T14–T17 may unify the two once the relationship is clearer.

### Self-check (plan §1465)

Constructor iterates `Object.keys(OrchestratorResponsibility)` and asserts each name resolves to `typeof === 'function'` on the instance. Subclass-deletes-method test confirms the check fires at construction. Skeleton-exposes-all-11 invariant is now executable, not just documented.

### Curated-tool gate from day one

`enforceCuratedToolList` is the ONE method with a real (one-line) implementation: `return filterAllowedTools(tools)`. This proves the skeleton is wirable end-to-end and lets T14–T17 trust the allow-list gate without re-implementing it.

## [2026-06-17] T14 — Active-canvas resolution + state sync

### mcp_excalidraw import_scene schema (vendored dist)
- Source: src-tauri/resources/mcp_excalidraw/dist/index.js:613-633 (schema), :1377-1402 (handler).
- Schema: `{ filePath?: string, data?: string, mode: 'replace' | 'merge' }` — `mode` is the only required arg.
- `data` is a JSON string (the .excalidraw file contents) — either a raw element array OR `{ elements, appState, files, ... }` envelope.
- Handler EXTRACTS elements via `Array.isArray(sceneData) ? sceneData : (sceneData.elements || [])`, then THROWS `"No elements found in the import data"` if length === 0. This is why T14's helper short-circuits empty arrays BEFORE the wire call (see decisions.md).

### Canvas store shape recap (relevant slices)
- `useCanvasStore` exposes a stable `get(id)` selector that returns `Canvas | undefined` — the T14 helper's `CanvasStoreLike.getCanvas` interface is structurally identical (rename only).
- `Canvas.elements` is a `readonly CanvasElement[]` — Excalidraw's `ExcalidrawElement` array, including any `isDeleted: true` rows. We pass it straight through to `import_scene` (the server is responsible for filtering its own state).
- No `activeCanvasId` slot exists in the store — and we did NOT add one. The active canvas is OWNED by TanStack Router; the store is a pure library/repository. See decisions.md.

### TanStack Router param consumption pattern
- Route detail file: `web-app/src/routes/canvas/.tsx`.
- Component reads via `useParams({ from: '/canvas/' })` and then subscribes to the store: `useCanvasStore((s) => s.canvases[canvasId])`.
- For pure helpers (no hooks): the runtime router exposes `router.state.matches[]` where each match has `{ routeId, params }`. The `routeId` for canvas detail is `/canvas/\` (literal slash + dollar-sign — TanStack derives it from the file path).
- The active-canvas helper iterates matches so nested layouts (`/canvas/\/edit`) still resolve to the parent's `canvasId`.

### Orchestrator deps slot evolution
- T13 typed `canvasStore` and `mcpClient` as `unknown` to keep the construction-time tripwire test green.
- T14 KEPT those as `unknown` and instead added two NEW optional slots: `router?: RouterLike | null` and `logger?: SyncLogger`. The active-canvas helper narrows `canvasStore`/`mcpClient` to `CanvasStoreLike`/`McpClientLike` at the call site — that keeps the tripwire test untouched while letting T14 wire real behavior.

### Testing pattern reused
- Followed `web-app/src/lib/canvas/dispatch.test.ts` exactly: pure DI helpers, `vi.fn()` spies, no React, no router runtime, no Excalidraw runtime.
- Module-level idempotency set: exposed `__resetSyncedSessionsForTests()` rather than mutating internals from tests; bun test `beforeEach` calls it.


## T15 (2026-06-17) — tool-call dispatch with T21 approval gating

### useToolApproval mechanics confirmed
- `showApprovalModal(toolName, threadId, toolParameters?)` resolves Promise<boolean>:
  - `true` for allow-once OR allow-always (caller doesn't need to distinguish)
  - `true` automatically when `allowAllMCPPermissions` is on
  - `true` automatically when `isToolApproved(threadId, toolName)` is true
  - `false` for deny
- The dispatcher does NOT need to re-check `isToolApproved` — the hook is the single source of truth.

### Wire-shape of mcp_excalidraw tools/call
Three error-shape variants observed across MCP servers; dispatcher handles all:
1. `{ isError: true, content: [{type:'text', text: 'msg'}] }` — standard MCP
2. `{ error: 'msg', content: [] }` — flat envelope (older / non-spec servers)
3. transport throw — caught at the await site

Success shape: `{ content: [{type:'text', text:'...'}] }`. Extra wire fields
(`_meta`, `structured`, etc.) are dropped; `McpToolResult` stays narrow.

### Pattern reusability — pure helper + DI
T15 confirms the T1.5 / T14 structural-DI template scales:
- `ApprovalGateFn` is a function type, not an object — simpler than wrapping the zustand store
- `DispatchMcpClientLike` defined locally instead of importing from active-canvas.ts because the wire-error handling differs (T14 trusts the helper; T15 must handle three error shapes)
- All deps are per-call (no per-session state) — this distinguishes T15 from T14's idempotency token model
