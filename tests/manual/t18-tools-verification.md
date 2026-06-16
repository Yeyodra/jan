# T18 Canvas AI Tools — End-to-End Verification (Wave 1, Task T1)

**Plan:** `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` (lines 419–513)
**Branch:** `feat/excalidraw-mcp`
**Date:** 2026-06-16
**Author:** Sisyphus-Junior (Atlas worker)
**Verdict:** **FAIL — T18 dispatcher is missing the `canvas_*` route branch.** Wave 2 cannot start until this is fixed.

---

## 1. Executive Summary

The T18 surface decomposes cleanly into three layers:

| Layer | File | Status |
|---|---|---|
| **Tool authoring** (handlers, zod schemas, JSON Schema) | `web-app/src/lib/canvas/ai-tools.ts`, `web-app/src/lib/canvas/schemas.ts` | ✅ PASS — 5 tools, correct `mutatingToolNames`, vitest 19/19 green |
| **Registry projection** (canvas tools surfaced as `MCPTool[]`) | `web-app/src/hooks/useTools.ts`, `web-app/src/hooks/useAppState.ts` | ✅ PASS — projection runs, `canvasToolNames` set correctly |
| **Dispatcher routing** (LLM tool call → canvas handler) | `web-app/src/routes/threads/$threadId.tsx` | ❌ **FAIL — no canvas branch; calls fall through to "Tool not found"** |

The plan asserted that T18 was a fully working foundation. The first two layers are sound; the third has never been wired. Any LLM call to `canvas_list`, `canvas_create`, `canvas_read`, `canvas_update`, or `canvas_delete` will be advertised to the model but, when invoked, will return:

```
Tool 'canvas_<x>' not found in any service
```

A second, lower-priority bug is also present in the same dispatcher: the approval gate special-cases `ragToolNames` as auto-approved but **does not recognize T18 read-only tools** (`canvas_list`, `canvas_read`). Even if the dispatcher branch existed, those two tools would erroneously trigger the approval modal.

This is a **Wave-1 gating failure**: Tasks 2–22 reference the T18 surface as already-working. They will all need to be re-evaluated once the dispatcher is fixed.

---

## 2. Tool-by-Tool Static Contract Verification

### 2.1 Five tools exist and are exported correctly

`web-app/src/lib/canvas/ai-tools.ts` defines and exports:

| Tool name (LLM-facing) | Definition site | Mutating? | Schema (input → output) | Handler |
|---|---|---|---|---|
| `canvas_list` | `ai-tools.ts:296-322` | No | `canvasListInputSchema` → `canvasListOutputSchema` | `useCanvasStore.listOrderedByUpdated()`, sliced to `CANVAS_LIST_LIMIT=50` |
| `canvas_create` | `ai-tools.ts:331-373` | **Yes** | `canvasCreateInputSchema` → `canvasCreateOutputSchema` | `useCanvasStore.create(name, scene?)` then `get(id)` |
| `canvas_read` | `ai-tools.ts:383-412` | No | `canvasReadInputSchema` → `canvasReadOutputSchema` | `useCanvasStore.get(id)`; `files` stripped to bound LLM context |
| `canvas_update` | `ai-tools.ts:421-477` | **Yes** | `canvasUpdateInputSchema` (with `.refine` "at-least-one-of name/scene") → `canvasUpdateOutputSchema` | `store.update(id, partial)` |
| `canvas_delete` | `ai-tools.ts:485-503` | **Yes** | `canvasDeleteInputSchema` → `canvasDeleteOutputSchema` | `store.delete(id)` |

Aggregate exports (`ai-tools.ts:513-538`):

```ts
export const canvasBuiltinTools: readonly CanvasBuiltinTool[] = [
  canvasListTool, canvasCreateTool, canvasReadTool,
  canvasUpdateTool, canvasDeleteTool,
] as const

export const mutatingToolNames: ReadonlySet<string> = new Set([
  'canvas_create', 'canvas_update', 'canvas_delete',
])

export const canvasBuiltinToolsByName: ReadonlyMap<string, CanvasBuiltinTool> =
  new Map(canvasBuiltinTools.map((t) => [t.name, t]))
```

All five tool names match the plan's spec (`ai-tools.ts:10-22`). All three mutating-set members match the plan's gating semantics (`ai-tools.ts:24-30`).

**Verdict:** ✅ **PASS** — tool authoring is contract-correct.

### 2.2 Each handler validates input AND output against zod

`runHandler` (`ai-tools.ts:146-162`) catches `z.ZodError`, formats it via `formatZodError`, and re-throws as a model-friendly `Error`. Every handler invokes `<schema>.parse(args)` on entry and `<output>.parse(...)` on the way out.

**Verdict:** ✅ **PASS** — schema/handler signatures align.

### 2.3 JSON Schema mirrors zod

The hand-written JSON Schema (`ai-tools.ts:175-283`) is what the LLM actually receives. Spot-checked for parity with `web-app/src/lib/canvas/schemas.ts`:

- `canvas_list` input: `{}` (empty) ↔ `canvasListInputSchema = z.object({}).strict()`
- `canvas_create` input: `{name: string(min 1, max 120), scene?: sceneJsonSchema}` ↔ `canvasCreateInputSchema`
- `canvas_read` input: `{id: uuid}` ↔ `canvasReadInputSchema`
- `canvas_update` input: `{id: uuid, name?: string, scene?: scene}` ↔ `canvasUpdateInputSchema` (the `.refine` "at-least-one" rule is enforced in zod, not JSON Schema — acceptable; the model gets a clear error from `runHandler` if it sends neither)
- `canvas_delete` input: `{id: uuid}` ↔ `canvasDeleteInputSchema`

**Verdict:** ✅ **PASS** — schemas match across the boundary.

### 2.4 Error messages are model-friendly

Spot-checked error paths:

- Unknown id: `throw new Error(\`Canvas not found: ${id}\`)` (passes through `runHandler` because it already starts with `Canvas `).
- Empty name: `Error: canvas_create failed: name must be a non-empty string`.
- Update with neither name nor scene: rejected at zod's `.refine`, surfaced as `canvas_update failed: ...`.
- Any other error: wrapped as `Canvas operation failed: <msg>` so the model never sees raw stack traces.

**Verdict:** ✅ **PASS** — well-shaped feedback loop for LLM self-correction.

---

## 3. Registry Projection (Layer 2)

### 3.1 `useTools.ts` projects T18 tools into `MCPTool[]`

`web-app/src/hooks/useTools.ts:9-25`:

```ts
import { canvasBuiltinTools } from '@/lib/canvas/ai-tools'

const canvasToolsAsMCP: MCPTool[] = canvasBuiltinTools.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
  server: t.server,           // 'canvas' (CANVAS_TOOL_SERVER)
}))
```

The `handler` field is intentionally stripped (the `MCPTool` registry is "a pure data view"). The dispatcher is supposed to re-resolve handlers by name from `canvasBuiltinToolsByName` at call time — see comment on line 18.

### 3.2 Shadow check defends against name collisions with remote MCP

Lines 47-69 fetch `[mcpTools, ragToolNames, canvasTools]` in parallel, filter `canvasTools` against the MCP name set, and warn if any T18 name has been shadowed by a remote MCP tool. The warning is logged and the canvas tool is silently dropped — see issues.md note for a UX gap (silent drop is acceptable for v1 but should be visible at provider-config time).

### 3.3 Final projection writes three name sets to `useAppState`

Lines 84-86:

```ts
updateMcpToolNames(mcpNames)
updateRagToolNames(ragOnly)
updateCanvasToolNames(canvasNotShadowed.map((t) => t.name))
```

`useAppState.ts:22-24, 52, 89, 134-135` define `canvasToolNames: Set<string>` and `updateCanvasToolNames`.

**Verdict:** ✅ **PASS** — registry projection is correct.

### 3.4 Test coverage for the projection layer

`web-app/src/hooks/__tests__/useTools.test.ts` exists and covers:
- L93: `expect(mockUpdateCanvasToolNames).toHaveBeenCalledWith(['canvas_list'])` — confirms the canvas list flows in.
- L190: assertion that `updateCanvasToolNames` is **not** called when the projection is shadowed.

(Verified to exist — not re-run here, but listed for downstream completeness.)

---

## 4. Dispatcher Routing (Layer 3) — **FAIL**

### 4.1 The dispatch site

The only place in the codebase where MCP tool calls are dispatched after LLM-emitted `tool_call`s arrive is `web-app/src/routes/threads/$threadId.tsx` (specifically the loop at lines 313–366, inside the streaming response handler).

```ts
// $threadId.tsx:313-314
const ragToolNames = useAppState.getState().ragToolNames
const mcpToolNames = useAppState.getState().mcpToolNames
// NOTE: canvasToolNames is NEVER read.

// $threadId.tsx:325-332 — approval gate
const toolName = toolCall.toolName
const approved = ragToolNames.has(toolName)
  ? true   // RAG: auto-approve (built-in)
  : await useToolApproval.getState()
      .requestApproval(toolCall.toolCallId, toolName, threadId)
// NOTE: mutatingToolNames is NEVER consulted; canvas read-only tools
//       (canvas_list, canvas_read) would always trigger the modal here.

// $threadId.tsx:347-366 — routing
if (ragToolNames.has(toolName)) {
  result = await serviceHub.rag().callTool({ ... })
} else if (mcpToolNames.has(toolName)) {
  result = await serviceHub.mcp().callTool({ ... })
} else {
  // Tool not found in either service
  result = { error: `Tool '${toolName}' not found in any service` }
}
```

### 4.2 Definitive confirmation

```
PS> grep "canvas" web-app/src/routes/threads/$threadId.tsx
(no matches)
```

**Zero references to `canvas`, `canvasToolNames`, `canvasBuiltinToolsByName`, or `mutatingToolNames` exist in the dispatcher.** The plan's "T18 wired" assertion is wrong at this layer.

### 4.3 What the LLM will actually experience

1. `useTools.ts` advertises all 5 canvas tools to the model via `updateTools(mergedTools)`.
2. Model emits `tool_call { toolName: 'canvas_list' }`.
3. Dispatcher checks: `ragToolNames.has('canvas_list')` → false. `mcpToolNames.has('canvas_list')` → false (it's in `canvasToolNames`, a different set).
4. Dispatcher: `result = { error: "Tool 'canvas_list' not found in any service" }`.
5. `addToolOutput({ state: 'output-error', errorText: 'Error: Tool ...' })` — the error round-trips back to the model.
6. Every subsequent canvas tool call ends the same way.

### 4.4 Secondary defect: read-only approval gating

Even if the routing branch existed, lines 328-332 only auto-approve `ragToolNames`. Read-only canvas tools (`canvas_list`, `canvas_read`) would trigger the approval modal. The plan's QA scenario (line 484: *"modal does NOT appear (read-only)"*) would fail. The fix needs a second condition:

```ts
const approved = ragToolNames.has(toolName) ||
                 (canvasToolNames.has(toolName) && !mutatingToolNames.has(toolName))
                   ? true
                   : await useToolApproval...
```

### 4.5 Tertiary concern: `MCPToolCallResult` shape mismatch

`MCPToolCallResult` (`core/src/types/mcp/mcpEntity.ts:12-18`):

```ts
{ error: string; content: Array<{type?: string; text: string}> }
```

T18 handlers return raw objects (e.g. `{id, name, createdAt}`). When the canvas dispatch branch is added, the handler return value must be marshalled into the `content: [{ type: 'text', text: JSON.stringify(...) }]` envelope (or whatever the AI SDK expects from a tool result). This is a wiring detail the fix-task must handle.

---

## 5. Vitest Run

```
PS C:\Users\Nazril\Documents\Projek\jan\web-app> bun test src/lib/canvas/ai-tools.test.ts

src\lib\canvas\ai-tools.test.ts:
(pass) canvas ai-tools — module surface > exposes exactly 5 tools via canvasBuiltinTools and the by-name map
(pass) canvas ai-tools — module surface > marks exactly the three mutating tools and no others
(pass) canvas ai-tools — module surface > pins CANVAS_LIST_LIMIT to 50 and CANVAS_TOOL_SERVER to "canvas"
(pass) canvas ai-tools — module surface > every tool tags itself with the canvas server and exposes a handler
(pass) canvas_create — handler > creates a canvas, returns {id, name, createdAt}, and persists into the store
(pass) canvas_create — handler > forwards an optional scene into the new canvas
(pass) canvas_create — handler > rejects an empty name through the zod input schema
(pass) canvas_read — handler > returns the full canvas record (with scene wrapper, files stripped)
(pass) canvas_read — handler > throws "Canvas not found: <id>" when the id is unknown
(pass) canvas_read — handler > rejects a non-UUID id through the zod input schema
(pass) canvas_update — handler > renames the canvas, refreshes updatedAt, and leaves createdAt untouched
(pass) canvas_update — handler > updates the scene without touching the name
(pass) canvas_update — handler > rejects an update with neither name nor scene (zod .refine)
(pass) canvas_update — handler > throws "Canvas not found" when the id is unknown
(pass) canvas_delete — handler > hard-deletes the canvas and returns {id, deleted:true}
(pass) canvas_delete — handler > throws "Canvas not found" when the id is unknown
(pass) canvas_list — handler > returns metadata sorted by updatedAt descending
(pass) canvas_list — handler > caps the result at 50 entries and returns the most-recently-updated
(pass) canvas_list — handler > returns an empty array when the store is empty
 19 pass
 0 fail
 125 expect() calls
Ran 19 tests across 1 file. [656.00ms]
```

**Result:** 19/19 passing. Confirms Layers 1 & 2 in isolation. Says nothing about Layer 3 because the test stubs the dispatch path with the in-process map — exactly the gap this report exposes.

**Sibling file note:** Running the full `src/lib/canvas/` test directory surfaces 2 pre-existing failures in `exporters.test.ts` — `ReferenceError: window is not defined` thrown by `@excalidraw/excalidraw`'s prod bundle when imported under bun's default (non-jsdom) environment. These are environmental, predate T1 (the file last changed in PR #2 `924522058`), are outside the T18 surface, and do not affect this verdict. Filed for tracking, not gating.

---

## 6. Real-LLM Run — Skipped (Justification)

The plan's QA scenarios require a live Jan instance with a tool-capable model. Environment probe results:

| Capability | Status | Evidence |
|---|---|---|
| Jan binary built | ✅ Found | `src-tauri/target/debug/Jan.exe` (60 MB, built 2026-06-16 22:31) |
| Jan user data dir | ✅ Present | `%APPDATA%\Jan\data\` populated (extensions, threads, llamacpp) |
| Local model installed | ✅ One available | `Jan-v3.5-4B-Q4_K_XL` (~3 GB, llama.cpp backend) |
| Remote provider with API key | ❌ None | No  any other tool-capable remote provider configured. `mcp_config.json` lists MCP servers (mostly inactive) but no chat provider. |

**Decision:** Real-LLM verification is **skipped** (not just blocked) for a *stronger* reason than environment: **the dispatcher bug found in §4 makes the LLM run pre-determined to fail on every tool call**. Running Playwright against Jan would only re-confirm what the static analysis already proves. Spending build/setup cycles to capture screenshots of "Tool not found in any service" five times would be theatre.

The right next step is for **Atlas to spin up a follow-up task to fix the dispatcher** (and the secondary approval-gate gap), then re-run T1 against the fixed dispatcher. At that point, the real-LLM run becomes meaningful and Playwright capture is appropriate.

> Per task spec §5: *"if real-LLM run is impossible in the current env, the deliverable becomes 'static-and-test verification with documented environment-blocker for the real-LLM portion'. Atlas will accept this with the explicit blocker doc."*
>
> Here the blocker is **architectural**, not environmental. Documented above.

---

## 7. Verdict & Recommended Follow-up

### 7.1 Verdict: **FAIL**

T18 cannot serve as a foundation for Wave 2 in its current state. Two of three layers are correct and well-tested; the third (dispatcher routing) was never written. The plan's "T18 wiring landed" claim refers to the *registry* projection, not the dispatcher.

### 7.2 Required fix before Wave 2 starts

A new task (call it **T1.5: dispatcher canvas-route**) must:

1. **Modify** `web-app/src/routes/threads/$threadId.tsx`:
   - Read `canvasToolNames` from `useAppState` alongside the existing two name sets.
   - Add a third routing branch that resolves the handler via `canvasBuiltinToolsByName.get(toolName)`, awaits its result, and marshals the return into `MCPToolCallResult.content` shape (`[{ type: 'text', text: JSON.stringify(result) }]`). On thrown error, populate `result.error`.
   - Update the approval gate to auto-approve canvas read-only tools: `canvasToolNames.has(toolName) && !mutatingToolNames.has(toolName)`.
2. **Add** a vitest covering the new dispatcher branch (a small unit test of the routing function would be ideal; alternative is an integration test under `__tests__/`).
3. **Re-run T1** with the QA scenarios from the plan against a live Jan instance.

This file (`tests/manual/t18-tools-verification.md`) should be **updated, not replaced**, after the fix lands — append a "§8. Re-verification (post-fix)" section with the real-LLM evidence and bump the verdict.

### 7.3 What does NOT need to change

- T18 tool definitions, schemas, names, mutating-set, error messages — all correct.
- `useTools.ts` projection — correct.
- `useAppState.ts` `canvasToolNames` slot — correct.
- The 19 vitest tests — correct.

### 7.4 Plan reference drift (also see `decisions.md`)

The plan repeatedly cites `web-app/src/hooks/use-chat.ts` + `web-app/src/routes/threads/$threadId.tsx` as the wiring layer. Reality:

- `use-chat.ts` does **not exist**.
- `$threadId.tsx` is the dispatch site (this report's §4) but contains no canvas wiring.
- The registry projection is in `useTools.ts` + `useAppState.ts` (this report's §3).

Future tasks must cite `useTools.ts` + `useAppState.ts` for registry work and `$threadId.tsx` for dispatcher work.

---

## 8. Evidence Index

- This report: `tests/manual/t18-tools-verification.md`
- Vitest output: inlined in §5 above (no separate evidence file needed; reproducible via `cd web-app && bun test src/lib/canvas/ai-tools.test.ts`)
- Static-analysis citations: line numbers in §2, §3, §4 above
- Real-LLM evidence: **NOT CAPTURED** — see §6 for justification. Atlas: do not request Playwright artifacts until T1.5 lands.


---

## 8. Re-verification (post-fix, T1.5)

**Date:** 2026-06-16
**Branch:** `feat/excalidraw-mcp`
**Verdict (static + vitest portion):** **PASS**
**Real-LLM portion:** still owed to the upcoming T1-rerun task (see §7.2).

### 8.1 What changed

Two surgical edits to `web-app/src/routes/threads/$threadId.tsx`, plus one new
pure-helper module:

1. **New file** `web-app/src/lib/canvas/dispatch.ts` (~80 lines). Exports
   `dispatchCanvasTool(toolName, args, deps?) => Promise<MCPToolCallResult>`.
   Resolves the handler through `canvasBuiltinToolsByName`, awaits it with
   `args ?? {}`, and marshals the raw return into the
   `{ error, content: [{ type: "text", text: JSON.stringify(...) }] }`
   envelope. Catches handler throws and produces the matching error envelope
   (never re-throws). Optional `deps.byName` exists only for test isolation.

2. **`$threadId.tsx`** — additions only, no behavioral regressions:
   - Imports `mutatingToolNames` from `@/lib/canvas/ai-tools` and
     `dispatchCanvasTool` from `@/lib/canvas/dispatch`.
   - Reads `canvasToolNames` from `useAppState.getState()` alongside the
     existing two name sets (line 317).
   - Approval gate (lines 330-342) is extended with an `isAutoApproved`
     predicate: `ragToolNames.has(toolName) || (canvasToolNames.has(toolName) && !mutatingToolNames.has(toolName))`.
     `canvas_list` and `canvas_read` now skip the modal; `canvas_create`,
     `canvas_update`, and `canvas_delete` continue to trigger it.
   - Routing block (lines 358-378) gains a third branch
     `else if (canvasToolNames.has(toolName))` that calls
     `dispatchCanvasTool(toolName, toolCall.input)`. RAG and MCP branches
     are byte-for-byte unchanged. The fallback now returns
     `{ error, content: [] }` so the rest of the loop's
     `if (result.error) ... else { output: result.content }` branching
     stays type-safe.

### 8.2 Dispatcher snippet (after fix)

```ts
// $threadId.tsx:314-317
const ragToolNames = useAppState.getState().ragToolNames
const mcpToolNames = useAppState.getState().mcpToolNames
const canvasToolNames = useAppState.getState().canvasToolNames

// $threadId.tsx:330-342 — approval gate
const isAutoApproved =
  ragToolNames.has(toolName) ||
  (canvasToolNames.has(toolName) && !mutatingToolNames.has(toolName))
const approved = isAutoApproved
  ? true
  : await useToolApproval
      .getState()
      .requestApproval(toolCall.toolCallId, toolName, threadId)

// $threadId.tsx:357-378 — routing
if (ragToolNames.has(toolName)) {
  result = await serviceHub.rag().callTool({ ... })
} else if (canvasToolNames.has(toolName)) {
  result = await dispatchCanvasTool(toolName, toolCall.input)
} else if (mcpToolNames.has(toolName)) {
  result = await serviceHub.mcp().callTool({ ... })
} else {
  result = { error: `Tool '${toolName}' not found in any service`, content: [] }
}
```

### 8.3 Test runs

#### 8.3.1 New dispatcher tests — `web-app/src/lib/canvas/dispatch.test.ts`

11 tests covering: happy paths (`canvas_list`, `canvas_create`, undefined-args),
error paths (handler throws, registry miss, zod input validation), approval-gate
predicate (read-only auto-approved, mutating not auto-approved, RAG and unknown
names unchanged, mutating-set drift detector), and registry alignment
(injected-deps path proves the parameter is honored; default path proves the
canonical map is the fallback).

```
PS C:\Users\Nazril\Documents\Projek\jan\web-app> npx vitest --run src/lib/canvas/dispatch.test.ts
 ✓ src/lib/canvas/dispatch.test.ts (11 tests) 21ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

#### 8.3.2 Existing T18 tests — still green

```
PS C:\Users\Nazril\Documents\Projek\jan\web-app> npx vitest --run src/lib/canvas/ai-tools.test.ts src/hooks/__tests__/useTools.test.ts src/lib/canvas/dispatch.test.ts
 ✓ src/lib/canvas/dispatch.test.ts   (11 tests)
 ✓ src/lib/canvas/ai-tools.test.ts   (19 tests)
 ✓ src/hooks/__tests__/useTools.test.ts (7 tests)
 Test Files  3 passed (3)
      Tests  37 passed (37)
```

#### 8.3.3 Typecheck (web-app)

```
PS C:\Users\Nazril\Documents\Projek\jan\web-app> npx tsc --noEmit -p tsconfig.app.json
src/components/compare/MasterPromptInput.tsx(321,7): error TS2322: ...
src/components/compare/MasterPromptInput.tsx(325,48): error TS2339: ...
src/components/compare/MasterPromptInput.tsx(335,45): error TS2339: ...
```

The three remaining errors are **pre-existing** and live in
`web-app/src/components/compare/MasterPromptInput.tsx` — completely outside
the T18 / dispatcher surface. Last touched by `308d8a9` (`feat(compare):
multi-model side-by-side chat with attachments`), which is upstream of this
branch. Filed-not-gating.

The two files this task changed (`$threadId.tsx`, `dispatch.ts`) and the
one file it added (`dispatch.test.ts`) all typecheck clean.

#### 8.3.4 Lint

```
PS C:\Users\Nazril\Documents\Projek\jan\web-app> npx eslint src/routes/threads/$threadId.tsx src/lib/canvas/dispatch.ts
(no output → 0 errors, 0 warnings)
```

### 8.4 What §7.2 (T1.5) item-by-item

| §7.2 requirement | Status |
|---|---|
| Read `canvasToolNames` alongside existing two name sets | ✅ `$threadId.tsx:317` |
| Third routing branch resolves via `canvasBuiltinToolsByName.get(...)` | ✅ via `dispatchCanvasTool` (`dispatch.ts:48-72`) |
| Marshal raw return into `MCPToolCallResult.content` envelope | ✅ `dispatch.ts:68` (`{ type: 'text', text: JSON.stringify(raw) }`) |
| On thrown error, populate `result.error` | ✅ `dispatch.ts:73-79` (never re-throws) |
| Auto-approve canvas read-only tools | ✅ `$threadId.tsx:335-337` (`canvasToolNames.has && !mutatingToolNames.has`) |
| New vitest covering the dispatcher branch | ✅ `dispatch.test.ts` (11 tests, all green) |
| Re-run T1 with QA scenarios against live Jan | ⏳ Deferred to T1-rerun (per task spec §5; T1.5 is the prerequisite) |

### 8.5 Updated verdict

**T1.5 (this task):** **PASS** — dispatcher branch wired, approval gate
extended, regression tests green, typecheck/lint clean on changed files.

**Wave 2 gating:** Wave 2 (vendoring + contract types + allow-list) is now
**unblocked from the dispatcher side**. The real-LLM end-to-end verification
remains owed but no longer architecturally pre-determined to fail — see
§7.2's "real-LLM run becomes meaningful" criterion, which is now satisfied.

The next pickup point is the T1-rerun task (Playwright + live model) per
plan §4.

