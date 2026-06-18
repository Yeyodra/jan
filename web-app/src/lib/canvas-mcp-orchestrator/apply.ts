/**
 * applyMutationsToCanvas — real implementation (T7)
 * ===================================================
 *
 * Translates a raw `McpToolResult` into `CanvasMutation[]` via the
 * orchestrator's `translateToolResult`, then dispatches each mutation to the
 * canvas through `orchestrator.applyDuringBatch`.
 *
 * Dispatch table:
 *   add     → applyDuringBatch(mutation.elements)
 *   update  → build patched element objects from ids+patch, applyDuringBatch
 *   delete  → build { id, isDeleted: true } stubs, applyDuringBatch
 *   reorder → ordering-only signal; no applyDuringBatch call
 *   noop    → silently skipped
 *
 * Error contract:
 *   Per-mutation errors are caught, logged, and swallowed. The loop
 *   continues with the remaining mutations so a single bad mutation cannot
 *   abort the entire batch.
 *
 * Abort contract:
 *   `opts.signal` is checked BEFORE each mutation. Once aborted, all
 *   remaining mutations are skipped and the function returns cleanly.
 *
 * MUST NOT:
 *   - Call `excalidrawAPI.updateScene()` directly (goes through
 *     `orchestrator.applyDuringBatch` only)
 *   - Import React, zustand, or @excalidraw/excalidraw at module top-level
 *     (orchestrator isolation contract)
 *   - Throw on individual mutation failure
 *   - Mutate the input mutations array
 */

// ---------------------------------------------------------------------------
// Inline types (./types and ./index are not present in this directory)
// ---------------------------------------------------------------------------

/** Raw result returned by a dispatched MCP tool call. */
export type McpToolResult = Record<string, unknown>

/** Minimal shape of a canvas mutation produced by translateToolResult. */
type CanvasMutation =
  | { kind: 'add'; elements: Record<string, unknown>[] }
  | { kind: 'update'; ids: string[]; patch: Record<string, unknown> }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'reorder'; ids: string[] }
  | { kind: 'noop' }

/** Minimal orchestrator surface consumed by applyMutationsToCanvas. */
export type CanvasMcpOrchestrator = {
  translateToolResult(result: McpToolResult): CanvasMutation[]
  applyDuringBatch(elements: Record<string, unknown>[]): void
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal logger surface. Mirrors `BatchLogger` in `./batch.ts` so callers
 * can pass the same logger instance without an adapter.
 */
export type Logger = {
  warn?: (msg: string, meta?: Record<string, unknown>) => void
  error?: (msg: string, meta?: Record<string, unknown>) => void
}

export type ApplyOptions = {
  /** AbortSignal forwarded from the route's toolCallAbortController. */
  signal?: AbortSignal
  /** Optional logger for per-mutation error reporting. */
  logger?: Logger
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Apply mutations from a single tool call result to the canvas.
 *
 * Translates `result` into `CanvasMutation[]` via
 * `orchestrator.translateToolResult`, then dispatches each applicable
 * mutation through `orchestrator.applyDuringBatch`.
 *
 * @param result       - Raw `McpToolResult` returned by `orchestrator.dispatchToolCall`
 * @param orchestrator - Orchestrator instance (for translateToolResult + applyDuringBatch)
 * @param opts         - Optional abort signal and logger
 */
export async function applyMutationsToCanvas(
  result: McpToolResult,
  orchestrator: CanvasMcpOrchestrator,
  opts?: ApplyOptions,
): Promise<void> {
  const mutations = orchestrator.translateToolResult(result)

  for (const mutation of mutations) {
    // Abort check before each mutation so callers can cancel mid-batch.
    if (opts?.signal?.aborted) return

    try {
      switch (mutation.kind) {
        case 'add': {
          orchestrator.applyDuringBatch(mutation.elements)
          break
        }

        case 'update': {
          // Build one patched element object per id. Each is a fresh object
          // (no shared reference) so downstream code can mutate them safely.
          const elements = mutation.ids.map((id) => ({
            id,
            ...mutation.patch,
          }))
          orchestrator.applyDuringBatch(elements)
          break
        }

        case 'delete': {
          // Mark each targeted element as deleted. Excalidraw uses the
          // `isDeleted` flag to tombstone elements without removing them
          // from the scene array (required for collaboration sync).
          const elements = mutation.ids.map((id) => ({
            id,
            isDeleted: true,
          }))
          orchestrator.applyDuringBatch(elements)
          break
        }

        case 'reorder':
          // Ordering-only signal. No element data to push — the ordering
          // itself is encoded in the ids array and applied by the caller's
          // higher-level scene reconciliation (out of scope for this helper).
          break

        case 'noop':
          // Silently skip — the result-translator emits noop for unrecognised
          // tools and error envelopes. Nothing to apply.
          break

        // TypeScript exhaustive-check guard — keeps this switch honest if
        // new CanvasMutation kinds are added to types.ts in the future.
        default: {
          const _exhaustive: never = mutation
          void _exhaustive
          break
        }
      }
    } catch (err) {
      // Per-mutation error: log and continue. Do NOT throw — the outer loop
      // must proceed with remaining mutations (plan §T7 error contract).
      const message = err instanceof Error ? err.message : String(err)
      opts?.logger?.error?.('[applyMutationsToCanvas] mutation failed', {
        kind: (mutation as { kind: string }).kind,
        error: message,
      })
    }
  }
}
