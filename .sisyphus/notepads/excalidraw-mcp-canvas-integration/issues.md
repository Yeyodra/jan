# Issues — excalidraw-mcp-canvas-integration

(Append new issues with timestamp.)

## [2026-06-16] T1 — DISPATCHER MISSING CANVAS BRANCH (BLOCKER for Wave 2)

**Severity:** Wave-1 gating. T18 cannot serve as a foundation for Wave 2 until fixed.

**Symptom:** Any LLM tool call to `canvas_list`, `canvas_create`, `canvas_read`, `canvas_update`, or `canvas_delete` is advertised to the model (registry layer is correct) but, when invoked, returns `Tool '<name>' not found in any service` from the dispatcher fallback at web-app/src/routes/threads/$threadId.tsx:362-365.

**Root cause:** The dispatcher at L313-366 only reads `ragToolNames` + `mcpToolNames` from useAppState. `canvasToolNames` is set correctly by useTools.ts but never consulted at the dispatch site. Verification: `grep canvas web-app/src/routes/threads/$threadId.tsx` -> 0 matches.

**Secondary defect (same file):** The approval gate at L328-332 only special-cases `ragToolNames` for auto-approval. Read-only canvas tools (`canvas_list`, `canvas_read`) would erroneously trigger the approval modal even when their dispatch branch is added.

**Tertiary concern:** `MCPToolCallResult.content` is `Array<{type?, text}>` (core/src/types/mcp/mcpEntity.ts). T18 handlers return raw objects; the future canvas dispatch branch must marshal results into this envelope.

**Cannot fix in T1 scope:** Task §5 forbids touching files outside the T18 surface (`lib/canvas/`, `hooks/useTools.ts`, `hooks/useAppState.ts`). The dispatcher (`routes/threads/$threadId.tsx`) is out of scope. Reported here so Atlas can spin up T1.5 (dispatcher canvas-route).

**Recommended fix shape (for the follow-up task):**
- Read canvasToolNames in the dispatcher.
- Add a third routing branch: `canvasBuiltinToolsByName.get(toolName)?.handler(args)` -> wrap into MCPToolCallResult envelope.
- Update approval gate: auto-approve when `canvasToolNames.has(name) && !mutatingToolNames.has(name)`.



## [2026-06-16] T1.5 — RESOLVED: dispatcher canvas-route gap

Closing the issue logged on the same day. The dispatcher at `web-app/src/routes/threads/$threadId.tsx` now reads `canvasToolNames` and routes canvas tool calls through `dispatchCanvasTool` (new helper at `web-app/src/lib/canvas/dispatch.ts`). The approval gate predicate is extended so read-only canvas tools (`canvas_list`, `canvas_read`) skip the modal while mutating ones (`canvas_create`, `canvas_update`, `canvas_delete`) continue to require user approval. Static verification, vitest (11 new + 19 existing + 7 useTools = 37 total passing), typecheck, and lint all green on the changed files. See `tests/manual/t18-tools-verification.md` §8 for the full re-verification record.

### Snags encountered

1. **`bun test` and jsdom mismatch.** Running `bun test src/hooks/__tests__/useTools.test.ts` fails with `ReferenceError: document is not defined` because bun's test runner does not honor vitest's `environment: 'jsdom'` config. Workaround: use `npx vitest --run <path>` for any test that imports React or testing-library. Pure module tests (like the new `dispatch.test.ts`) work under either runner. The task spec suggested `bun test` for the existing test files — switched to `npx vitest` to keep them passing without environment churn.

2. **`canvas_list` output shape is `{canvases: [...]}` (object), not a bare array.** First test draft asserted `JSON.parse(text)` was an array; the schema (`canvasListOutputSchema`) actually wraps it: `{ canvases: z.array(canvasMetaSchema) }`. Fixed before any test ran.

3. **`createdAt` is an ISO-8601 string, not a number.** The plan's pseudocode and the T18 description both implied a numeric timestamp. The schema (`canvasCreateOutputSchema`) is `z.iso.datetime({ offset: true })` → string. Fixed assertion to `typeof === 'string'` + `Date.parse(...)`.

4. **Fallback branch in `$threadId.tsx` needed `content: []` added.** The pre-T1.5 fallback returned `{ error: '...' }` without `content`, which violated the `MCPToolCallResult` type. The downstream `addToolOutput({output: result.content})` would have crashed had it ever fired. Fixed at the same time as the canvas branch addition — single-line change, no behavioral risk because the error branch always runs the `if (result.error)` path first.

5. **Pre-existing typecheck noise.** `npx tsc --noEmit -p tsconfig.app.json` reports 3 errors in `src/components/compare/MasterPromptInput.tsx` (DialogService type mismatch). Pre-existing on `main` per `git log`; outside this task's scope. Filed but not gating.
