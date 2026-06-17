/**
 * Canvas tool dispatcher (T1.5).
 *
 * Pure helper that resolves a canvas tool name to its handler (from the
 * `canvasBuiltinToolsByName` registry built in `./ai-tools.ts`), invokes it
 * with the model-provided args, and marshals the raw handler return value
 * into the `MCPToolCallResult` envelope the thread dispatcher already speaks.
 *
 * Extracted from `web-app/src/routes/threads/$threadId.tsx` so that the
 * branching logic can be unit-tested in isolation without standing up the
 * full streaming chat surface. The thread-route dispatcher imports this
 * function and calls it inside the existing `canvasToolNames.has(toolName)`
 * branch of the tool-call processing loop.
 *
 * Contract:
 *   - Resolves the handler via the injected `byName` map (defaults to the
 *     module-level `canvasBuiltinToolsByName`). Injection exists purely for
 *     test isolation.
 *   - Always returns an `MCPToolCallResult` — never throws. Handler-thrown
 *     errors (including zod validation errors surfaced via `runHandler`) are
 *     captured into `result.error` so the rest of the dispatcher can keep
 *     its existing `if (result.error) ... else ...` branching.
 *   - Successful results are JSON-stringified into a single
 *     `content: [{ type: 'text', text: ... }]` entry. The AI SDK consumes
 *     `output: result.content` (see `$threadId.tsx`) — keeping the same
 *     shape that the RAG and MCP services already emit keeps the downstream
 *     code path identical.
 *   - `args` defaults to `{}` when undefined so tools whose zod schema is
 *     `z.object({}).strict()` (e.g. `canvas_list`) don't trip on `undefined`.
 */
import type { MCPToolCallResult } from '@janhq/core'

import {
  canvasBuiltinToolsByName,
  type CanvasBuiltinTool,
} from './ai-tools'

export type CanvasToolDispatchDeps = {
  byName?: ReadonlyMap<string, CanvasBuiltinTool>
}

/**
 * Dispatch a canvas tool call and produce an `MCPToolCallResult`.
 *
 * @param toolName  LLM-emitted tool name (e.g. `canvas_list`).
 * @param args      Raw args object the model emitted. May be undefined.
 * @param deps      Optional dependency injection for tests.
 */
export const dispatchCanvasTool = async (
  toolName: string,
  args: unknown,
  deps: CanvasToolDispatchDeps = {}
): Promise<MCPToolCallResult> => {
  const registry = deps.byName ?? canvasBuiltinToolsByName
  const tool = registry.get(toolName)

  if (!tool) {
    // Defensive: the caller (`$threadId.tsx`) already gated on
    // `canvasToolNames.has(toolName)` before reaching here, so a miss means
    // the projection (`useTools.ts`) and the registry have drifted out of
    // sync. Surface a model-friendly error rather than throwing.
    const message = `Canvas tool '${toolName}' is not registered`
    return {
      error: message,
      content: [{ type: 'text', text: message }],
    }
  }

  try {
    const raw = await tool.handler(args ?? {})
    return {
      error: '',
      content: [{ type: 'text', text: JSON.stringify(raw) }],
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Canvas tool failed: unknown error'
    return {
      error: message,
      content: [{ type: 'text', text: message }],
    }
  }
}
