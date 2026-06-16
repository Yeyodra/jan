/**
 * CanvasMcpOrchestrator — Contract Types
 * =======================================
 *
 * Types-only module. Zero runtime logic (except the `OrchestratorResponsibility`
 * const used for runtime self-check and tests).
 *
 * Wave 4 implementation tasks (T13–T17) consume these types as their contract.
 *
 * The orchestrator is the bridge between mcp_excalidraw (MCP server) and Jan's
 * canvas-store. It owns the following 11 responsibilities, copied verbatim from
 * the plan (Wave 4, T13):
 *
 *   1.  resolveActiveCanvas(): string | null
 *       — active-canvas resolution
 *   2.  dispatchToolCall(call: McpToolCall): Promise<McpToolResult>
 *       — gated dispatch
 *   3.  translateElementId(mcpId: string): string
 *       — ID translation
 *   4.  syncStateFromCanvas(): Promise<void>
 *       — push canvas-store state into mcp_excalidraw at session start
 *   5.  beginAiBatch(): BatchToken
 *       — undo grouping start (returns token used by endAiBatch)
 *   6.  endAiBatch(token: BatchToken): void
 *       — commits one history entry via captureUpdate
 *   7.  handleProcessCrash(): Promise<void>
 *       — orchestrate restart + state replay
 *   8.  translateToolResult(result: McpToolResult): CanvasMutation[]
 *       — MCP → canvas-store mutations
 *   9.  applyTheme(elements: ExcalidrawElement[]): ExcalidrawElement[]
 *       — apply Jan theme defaults
 *   10. lockManualEdits(): UnlockFn
 *       — concurrency control
 *   11. enforceCuratedToolList(tools: MCPTool[]): MCPTool[]
 *       — wraps `filterAllowedTools` from T8
 *
 * Design constraints (from plan §T7):
 *   - Compatible with Jan's existing `MCPToolCallResult` (`core/src/types/mcp/mcpEntity.ts`).
 *   - Decoupled from mcp_excalidraw internals (must allow future server swap).
 *   - Decoupled from `web-app/src/types/canvas.ts` (different concerns).
 */

// ---------------------------------------------------------------------------
// Lifecycle / state
// ---------------------------------------------------------------------------

/**
 * Inputs the orchestrator needs to start an MCP-driven drawing session.
 */
export type OrchestratorRequest = {
  canvasId: string
  prompt: string
  threadId: string
  modelId: string
}

/**
 * Finite-state-machine label for the orchestrator's current phase.
 * Exactly 5 states — keep this narrow; do not widen without updating tests.
 */
export type OrchestratorState =
  | 'idle'
  | 'spawning'
  | 'awaiting-approval'
  | 'drawing'
  | 'error'

// ---------------------------------------------------------------------------
// MCP wire shapes
// ---------------------------------------------------------------------------

/**
 * One MCP tool invocation. Mirrors the JSON-RPC `tools/call` payload shape used
 * by mcp_excalidraw and any other MCP server.
 */
export type McpToolCall = {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Discriminated union for an MCP tool's outcome.
 *
 * Structurally compatible with Jan's existing `MCPToolCallResult` from
 * `core/src/types/mcp/mcpEntity.ts`:
 *   - The success branch carries `content: Array<{ type: 'text', text: string }>`.
 *   - The error branch carries `error: string`.
 *
 * Adapters at the boundary may translate between this discriminated form and
 * Jan-core's flat `{ error, content }` shape.
 */
export type McpToolResult =
  | { content: Array<{ type: 'text'; text: string }> }
  | { error: string }

// ---------------------------------------------------------------------------
// Domain mappings
// ---------------------------------------------------------------------------

/**
 * Maps an mcp_excalidraw element id to its canvas-store element id.
 *   key:   mcp id (server-issued)
 *   value: canvas-store id (Jan-issued, persisted in `useCanvasStore`)
 */
export type ElementIdMapping = Map<string, string>

// ---------------------------------------------------------------------------
// Responsibility registry (runtime + type)
// ---------------------------------------------------------------------------

/**
 * Runtime registry of the 11 orchestrator responsibilities.
 *
 * - Used by `CanvasMcpOrchestrator` (T13) for self-check (assert all 11 are
 *   implemented at construction time).
 * - Used by `types.test.ts` to assert there are exactly 11 keys.
 *
 * Keys are method names (verbatim) on the orchestrator. Values are short
 * human-readable summaries (verbatim from the plan).
 */
export const OrchestratorResponsibility = {
  resolveActiveCanvas: 'active-canvas resolution',
  dispatchToolCall: 'gated dispatch',
  translateElementId: 'ID translation',
  syncStateFromCanvas:
    'push canvas-store state into mcp_excalidraw at session start',
  beginAiBatch: 'undo grouping start (returns token used by endAiBatch)',
  endAiBatch: 'commits one history entry via captureUpdate',
  handleProcessCrash: 'orchestrate restart + state replay',
  translateToolResult: 'MCP → canvas-store mutations',
  applyTheme: 'apply Jan theme defaults',
  lockManualEdits: 'concurrency control',
  enforceCuratedToolList: 'wraps `filterAllowedTools` from T8',
} as const

/**
 * Method-name union for the 11 responsibilities. Used as a key set for tests
 * and for any runtime dispatcher table the orchestrator may build.
 */
export type OrchestratorResponsibilityName = keyof typeof OrchestratorResponsibility

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/**
 * Per-session telemetry accumulator. `spawnDurationMs` is optional because it
 * is only known after the MCP server has spawned successfully; all other
 * counters start at 0 and are required.
 */
export type Telemetry = {
  spawnDurationMs?: number
  toolCallCount: number
  batchSize: number
  approvalCount: number
  errors: string[]
}
