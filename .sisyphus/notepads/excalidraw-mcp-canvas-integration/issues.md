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

