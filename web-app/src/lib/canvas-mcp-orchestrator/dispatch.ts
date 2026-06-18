/**
 * Tool-call dispatch with T21 approval gating reuse (Wave 4, T15)
 * =================================================================
 *
 * Pure helper consumed by `CanvasMcpOrchestrator.dispatchToolCall` (`./index.ts`).
 *
 * Three gates enforced in order:
 *
 *   1. Curated allow-list (`EXCALIDRAW_ALLOWED_TOOLS` from T8). Blocked OR
 *      unknown tool names are rejected without invoking any other gate or
 *      the wire transport. Returns `{ error: 'tool not available in this build' }`.
 *
 *   2. T21 approval (only for tools in `EXCALIDRAW_MUTATING_TOOLS`). The
 *      gate is injected as a function `(toolName, threadId, params) =>
 *      Promise<boolean>` so this module never imports the `useToolApproval`
 *      zustand store directly — keeps the orchestrator package pure-DI and
 *      unit-testable in bun-test without React.
 *
 *      The injected gate is expected to wrap `useToolApproval.getState()
 *      .showApprovalModal(...)`. That hook already auto-resolves `true`
 *      when (a) `allowAllMCPPermissions` is on, or (b) the tool is already
 *      approved for the thread. We do NOT re-check those here — single
 *      source of truth is the gate function.
 *
 *      Fail-closed: if `approvalGate` is undefined, mutating calls are
 *      denied with `{ error: 'tool requires approval but no gate configured' }`
 *      and a telemetry counter is incremented. This matches the plan's
 *      "approved invocation forwarded; denied returned to LLM" contract —
 *      a missing gate IS a denial.
 *
 *   3. mcp_excalidraw transport (`mcpClient.callTool(call)`). Result is
 *      normalized into the `McpToolResult` discriminated union:
 *        - success → `{ content: [...] }` (extra wire fields dropped)
 *        - wire-level error (`isError: true` OR top-level `error`) →
 *          `{ error: '<message>' }`
 *        - transport throw → `{ error: '<message>' }`
 *
 * Read-only tools (in `EXCALIDRAW_READONLY_TOOLS`) bypass the approval gate
 * entirely. They are still subject to the allow-list (which they pass by
 * construction — `EXCALIDRAW_ALLOWED_TOOLS = mutating ∪ readonly`).
 *
 * Never throws. Every failure mode returns a structured `McpToolResult` so
 * the LLM can observe it via the standard tool-result channel.
 *
 * Style alignment
 * ---------------
 * Mirrors the structural-DI pattern established in
 * `web-app/src/lib/canvas-mcp-orchestrator/active-canvas.ts` (T14):
 *   - `*-Like` types for transport / approval / logger / telemetry
 *   - No React, zustand, router, or Excalidraw imports at module top-level
 *   - Pure function; idempotency lives at the call-site (each dispatch is
 *     independent — there is no per-session token concept here, unlike T14)
 */
import {
  EXCALIDRAW_ALLOWED_TOOLS,
  EXCALIDRAW_READONLY_TOOLS,
  requiresApproval,
} from './curated-tools'
import type { McpToolCall, McpToolResult } from './types'
import type { BatchApprovalToken } from './approval'

// ---------------------------------------------------------------------------
// Structural DI contracts (no concrete imports)
// ---------------------------------------------------------------------------

/**
 * Approval-gate function shape. Wraps T21's `showApprovalModal`.
 *
 * Resolves `true` for allow-once / allow-always (the dispatcher only cares
 * that the call may proceed), `false` for deny. Implementations may also
 * resolve `true` automatically when the tool is already approved for the
 * thread or `allowAllMCPPermissions` is enabled — that policy lives in the
 * underlying store, not here.
 */
export type ApprovalGateFn = (
  toolName: string,
  threadId: string,
  parameters?: Record<string, unknown>,
) => Promise<boolean>

/**
 * Wire-shape returned by mcp_excalidraw's `tools/call`. We model the
 * surface defensively — different MCP servers serialize errors slightly
 * differently and we want to handle all of them.
 *
 * - `content`: standard MCP success payload. Array of typed blocks.
 * - `isError`: standard MCP error flag. When true, `content[0].text` is
 *   the error message.
 * - `error`:   non-standard but observed flat error. When present and
 *   non-empty, treat as failure regardless of `isError`.
 *
 * Anything else on the envelope is dropped — `McpToolResult` is the
 * narrow contract our orchestrator exposes upward.
 */
export type WireToolCallResult = {
  content?: Array<{ type?: string; text: string }>
  isError?: boolean
  error?: string
  // Tolerate extra fields silently. We never forward them.
  [extra: string]: unknown
}

/**
 * The narrowest slice of an MCP transport this dispatcher depends on.
 * Independent of `active-canvas.ts`'s `McpClientLike` because the wire
 * envelope handling differs (T14 trusts the helper's typing; T15 must
 * defensively handle multiple error shapes).
 */
export type DispatchMcpClientLike = {
  callTool: (call: McpToolCall) => Promise<WireToolCallResult | unknown>
}

/**
 * Logger contract. Same shape as T14 to keep DI ergonomics consistent.
 */
export type DispatchLogger = {
  debug?: (msg: string, meta?: Record<string, unknown>) => void
  warn?: (msg: string, meta?: Record<string, unknown>) => void
}

/**
 * Telemetry sink contract. Same shape as `TelemetrySink` in `./index.ts`,
 * re-stated here so this module stays import-graph-independent.
 */
export type DispatchTelemetry = {
  increment: (metric: string) => void
  timing?: (metric: string, ms: number) => void
}

/**
 * Inputs for one dispatch invocation.
 */
export type DispatchDeps = {
  /** mcp_excalidraw transport. */
  mcpClient: DispatchMcpClientLike
  /**
   * T21 approval gate. Function-shaped to avoid pulling the zustand store
   * into this module. Optional — when omitted, mutating calls fail closed.
   */
  approvalGate: ApprovalGateFn | undefined
  /** Active conversation thread id, threaded into the approval gate. */
  threadId: string
  /** Optional logger. */
  logger?: DispatchLogger
  /** Optional telemetry sink. */
  telemetry?: DispatchTelemetry
}

/**
 * Per-call options for `dispatchExcalidrawTool`. Optional second argument;
 * omitting it preserves the existing per-tool approval modal behaviour.
 */
export type DispatchOptions = {
  /**
   * When present, mutating tools bypass the per-tool approval modal for this
   * call. Issued by `CanvasMcpOrchestrator.setBatchApproval(token)` so that
   * canvas prompts can pre-approve all mutating calls at once.
   *
   * BLOCKED tools are NEVER bypassed — Gate 1 still runs first.
   * READONLY tools are unaffected — they already auto-approve.
   */
  batchApprovalToken?: BatchApprovalToken
}

// ---------------------------------------------------------------------------
// Error message constants (single source of truth for tests + production)
// ---------------------------------------------------------------------------

export const ERR_NOT_AVAILABLE = 'tool not available in this build'
export const ERR_USER_DENIED = 'user denied tool call'
export const ERR_GATE_MISSING = 'tool requires approval but no gate configured'
export const ERR_GENERIC_TOOL_ERROR = 'tool returned an error'

// ---------------------------------------------------------------------------
// dispatchExcalidrawTool
// ---------------------------------------------------------------------------

/**
 * Dispatch a curated mcp_excalidraw tool call. Never throws.
 *
 * @param call    - The MCP tool invocation to dispatch.
 * @param deps    - Injected dependencies (transport, approval gate, logger, telemetry).
 * @param options - Optional per-call options. When `batchApprovalToken` is
 *                  present, mutating tools skip the per-tool approval modal.
 *
 * @see file header for the gate ordering and rationale.
 */
export async function dispatchExcalidrawTool(
  call: McpToolCall,
  deps: DispatchDeps,
  options?: DispatchOptions,
): Promise<McpToolResult> {
  // -------------------------------------------------------------------------
  // Gate 1 — curated allow-list
  // -------------------------------------------------------------------------
  if (!EXCALIDRAW_ALLOWED_TOOLS.has(call.name)) {
    return { error: ERR_NOT_AVAILABLE }
  }

  // -------------------------------------------------------------------------
  // Gate 2 — T21 approval (mutating only)
  // -------------------------------------------------------------------------
  // Readonly tools bypass approval. We use the explicit readonly set rather
  // than `!requiresApproval(...)` so the bypass is auditable in code review.
  const isReadonly = EXCALIDRAW_READONLY_TOOLS.has(call.name)
  if (!isReadonly && requiresApproval(call.name)) {
    // Bulk-batch pre-approval: when a valid token is present, skip the
    // per-tool modal entirely and emit a telemetry event so the batch path
    // is traceable in analytics.
    if (options?.batchApprovalToken !== undefined) {
      deps.telemetry?.increment('batch.bulk_approved')
      // Fall through to Gate 3 — transport.
    } else {
      // Per-call approval path (existing behavior).
      deps.telemetry?.increment('batch.per_call_approved')

      if (!deps.approvalGate) {
        // Fail-closed: a mutating tool with no gate is an installation bug.
        // Surface it loudly via logger + telemetry; deny the call.
        deps.logger?.warn?.(
          'dispatchExcalidrawTool: mutating tool reached dispatch without an approval gate; denying',
          { toolName: call.name },
        )
        deps.telemetry?.increment('dispatch.approval_gate_missing')
        return { error: ERR_GATE_MISSING }
      }

      let approved: boolean
      try {
        approved = await deps.approvalGate(
          call.name,
          deps.threadId,
          call.arguments,
        )
      } catch (err) {
        // The gate itself threw. Treat as transport-style failure: never let
        // it escape, surface as an error envelope to the LLM.
        deps.telemetry?.increment('dispatch.approval_gate_threw')
        return { error: errorMessage(err) }
      }
      if (!approved) {
        deps.telemetry?.increment('dispatch.denied')
        return { error: ERR_USER_DENIED }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Gate 3 — wire transport
  // -------------------------------------------------------------------------
  let raw: unknown
  try {
    raw = await deps.mcpClient.callTool(call)
  } catch (err) {
    deps.telemetry?.increment('dispatch.transport_threw')
    return { error: errorMessage(err) }
  }

  return marshalWireResult(raw)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert any wire result into the narrow `McpToolResult` discriminated
 * union. Drops extra fields. Never throws.
 *
 * Precedence (worst → best):
 *   1. Top-level `error` string non-empty           → { error }
 *   2. `isError === true`                            → { error: content[0].text } (or generic)
 *   3. `content` is an array of `{ text: string }`   → { content: [...] } (text-blocks only)
 *   4. Anything else                                  → generic error envelope
 */
function marshalWireResult(raw: unknown): McpToolResult {
  if (raw === null || typeof raw !== 'object') {
    return { error: ERR_GENERIC_TOOL_ERROR }
  }
  const wire = raw as WireToolCallResult

  // (1) flat top-level error wins.
  if (typeof wire.error === 'string' && wire.error.length > 0) {
    return { error: wire.error }
  }

  // (2) standard MCP isError flag.
  if (wire.isError === true) {
    const first = Array.isArray(wire.content) ? wire.content[0] : undefined
    const text = typeof first?.text === 'string' && first.text.length > 0
      ? first.text
      : ERR_GENERIC_TOOL_ERROR
    return { error: text }
  }

  // (3) success. Re-pack `content` as the narrow shape — drop everything else.
  if (Array.isArray(wire.content)) {
    const content = wire.content
      .filter(
        (block): block is { type?: string; text: string } =>
          !!block && typeof (block as { text?: unknown }).text === 'string',
      )
      .map((block) => ({
        type: 'text' as const,
        text: block.text,
      }))
    return { content }
  }

  // (4) malformed envelope — fail soft.
  return { error: ERR_GENERIC_TOOL_ERROR }
}

/**
 * Stringify any thrown value into a human-readable error message.
 * Mirrors the "never let an Error leak unstringified" pattern used in
 * `web-app/src/lib/canvas/dispatch.ts`.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
