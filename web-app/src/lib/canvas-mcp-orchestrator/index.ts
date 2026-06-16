/**
 * CanvasMcpOrchestrator — Skeleton (Wave 4, T13)
 * ================================================
 *
 * The orchestrator is the bridge between mcp_excalidraw (an MCP server that
 * exposes drawing-tool primitives) and Jan's in-renderer Excalidraw canvas.
 * It owns 11 explicit responsibilities (see `OrchestratorResponsibility` in
 * `./types.ts`).
 *
 * This file is the SKELETON ONLY. T13's contract is:
 *
 *   - Expose all 11 responsibilities as public methods with correct
 *     type signatures.
 *   - Each responsibility (except `enforceCuratedToolList`) THROWS a
 *     `TODO(<name>): implemented in T<N> — see plan §<line>` Error so callers
 *     fail loud during the wiring waves (T14–T17, T22).
 *   - `enforceCuratedToolList` is the SINGLE method with a real (one-line)
 *     implementation. It wraps `filterAllowedTools` (T8). Doing this proves
 *     the skeleton is wirable end-to-end at construction time and keeps the
 *     curated-tool gate enforceable from day one.
 *   - Constructor performs a SELF-CHECK against the runtime registry
 *     (`OrchestratorResponsibility`) and throws if any required method is
 *     missing — the "skeleton exposes all 11 responsibilities" invariant
 *     (plan §1465).
 *
 * Implementation-task pointers (the TODO error messages reference these):
 *
 *   resolveActiveCanvas      → T14 (plan §1480)
 *   syncStateFromCanvas      → T14 (plan §1480)
 *   handleProcessCrash       → T14 (plan §1480)
 *   applyTheme               → T14 (plan §1480)
 *   dispatchToolCall         → T15 (plan §1569)
 *   translateElementId       → T16 (plan §1658)
 *   translateToolResult      → T16 (plan §1658)
 *   beginAiBatch             → T17 (plan §1733)
 *   endAiBatch               → T17 (plan §1733)
 *   lockManualEdits          → T22 (plan §2180)
 *   enforceCuratedToolList   → T13 (this file; one-liner over T8)
 *
 * Decoupling stance
 * -----------------
 * The constructor takes a `deps` object whose `canvasStore`, `mcpClient`, and
 * `themeProvider` slots are typed as `unknown`. This is DELIBERATE — the
 * skeleton must not commit to a concrete store/client shape because:
 *   1. T14 will refine `canvasStore` to a slice of `useCanvasStore` (zustand);
 *   2. T15 will refine `mcpClient` to whatever transport ships with
 *      mcp_excalidraw at the time of wiring;
 *   3. T13 must remain testable WITHOUT pulling React, zustand, the MCP
 *      runtime, or the Excalidraw bundle into vitest's module graph.
 *
 * Type-tightness deferred to T14–T17 (also recorded in
 * `.sisyphus/notepads/excalidraw-mcp-canvas-integration/learnings.md`).
 *
 * Style alignment
 * ---------------
 * Class form (not factory) chosen to match Jan's existing
 * `web-app/src/lib/mcp-orchestrator/mcp-orchestrator.ts`. Dependency
 * injection via constructor `deps` parameter — no global singletons.
 */

import type { MCPTool } from '@janhq/core'
import {
  OrchestratorResponsibility,
  type OrchestratorResponsibilityName,
  type McpToolCall,
  type McpToolResult,
  type ElementIdMapping,
} from './types'
import { filterAllowedTools } from './curated-tools'

// ---------------------------------------------------------------------------
// Telemetry sink (skeleton stub)
// ---------------------------------------------------------------------------

/**
 * Per-call telemetry sink injected via deps.
 *
 * Note: this is intentionally distinct from the per-session `Telemetry`
 * accumulator type already exported from `./types.ts`. The latter is an
 * aggregate snapshot (`toolCallCount`, `errors[]`, etc.); this one is a
 * push-style sink the orchestrator can call from inside method bodies. T14–
 * T17 may unify the two — for now they live side-by-side without coupling.
 */
export type TelemetrySink = {
  increment(metric: string): void
  timing(metric: string, ms: number): void
}

/**
 * No-op telemetry sink. Default when `deps.telemetry` is omitted.
 * Stable singleton — safe to share between instances.
 */
export const NoopTelemetry: TelemetrySink = {
  increment: () => {},
  timing: () => {},
}

// ---------------------------------------------------------------------------
// Skeleton placeholder return types
// ---------------------------------------------------------------------------

/**
 * Token returned by `beginAiBatch` and consumed by `endAiBatch`. Concrete
 * shape is decided in T17; for the skeleton we keep it opaque so callers
 * cannot depend on internals.
 */
export type BatchToken = symbol & { readonly __brand: 'CanvasMcpBatchToken' }

/**
 * Releases a manual-edit lock. Returned by `lockManualEdits`. Concrete
 * implementation lands in T22.
 */
export type UnlockFn = () => void

/**
 * Mutation operation produced by `translateToolResult`. The skeleton declares
 * this as `unknown` because T16 owns the discriminated-union design — adding
 * a placeholder shape here would lock in decisions that belong to T16.
 */
export type CanvasMutation = unknown

/**
 * Excalidraw-element placeholder. The Excalidraw runtime types live in the
 * vendored bundle; pulling them into the skeleton would couple T13 to T14's
 * theme-provider work. Refined in T14.
 */
export type ExcalidrawElement = unknown

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/**
 * Constructor dependencies for `CanvasMcpOrchestrator`.
 *
 * - `canvasStore`  — wired in T14 to a slice of `useCanvasStore`.
 * - `mcpClient`    — wired in T15 to the active mcp_excalidraw transport.
 * - `themeProvider`— wired in T13.x or T14 once the theme contract lands.
 * - `telemetry`    — optional; defaults to `NoopTelemetry`.
 *
 * The store/client/theme slots are typed as `unknown` deliberately. See the
 * file-header "Decoupling stance" section for the rationale.
 */
export type CanvasMcpOrchestratorDeps = {
  canvasStore: unknown
  mcpClient: unknown
  themeProvider?: unknown
  telemetry?: TelemetrySink
}

// ---------------------------------------------------------------------------
// Helper — TODO thrower
// ---------------------------------------------------------------------------

/**
 * Build a uniform TODO Error so every unimplemented method fails the same
 * way. Tests regex-match `<name>` and `T<N>` to confirm the message wires the
 * caller back to the implementing task.
 */
function todo(
  name: OrchestratorResponsibilityName,
  task: string,
  planLine: number,
): Error {
  return new Error(
    `TODO(${name}): implemented in ${task} — see plan §${planLine}`,
  )
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

/**
 * Skeleton orchestrator. See file header for full responsibility table.
 *
 * Construct with `new CanvasMcpOrchestrator(deps)`. The constructor runs a
 * runtime self-check against `OrchestratorResponsibility` and throws if any
 * of the 11 required methods is missing on the instance.
 */
export class CanvasMcpOrchestrator {
  /** Injected dependency bag. Refined incrementally across T14–T22. */
  protected readonly deps: CanvasMcpOrchestratorDeps
  /** Telemetry sink, defaulted to `NoopTelemetry` when not provided. */
  protected readonly telemetry: TelemetrySink

  constructor(deps: CanvasMcpOrchestratorDeps) {
    this.deps = deps
    this.telemetry = deps.telemetry ?? NoopTelemetry

    // Self-check (plan §1465): every key in the responsibility registry MUST
    // resolve to a callable method on this instance. Iterate the runtime
    // registry — not the type-level union — because only the registry is
    // observable at runtime.
    const required = Object.keys(
      OrchestratorResponsibility,
    ) as OrchestratorResponsibilityName[]
    const missing = required.filter(
      (name) =>
        typeof (this as unknown as Record<string, unknown>)[name] !==
        'function',
    )
    if (missing.length > 0) {
      throw new Error(
        `CanvasMcpOrchestrator: missing required methods: ${missing.join(',')}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // 1. resolveActiveCanvas — T14
  // -------------------------------------------------------------------------
  /**
   * Resolve the canvas-store id of the currently active canvas, or null when
   * no canvas is active. Implementation lands in T14.
   */
  resolveActiveCanvas(): string | null {
    throw todo('resolveActiveCanvas', 'T14', 1480)
  }

  // -------------------------------------------------------------------------
  // 2. dispatchToolCall — T15
  // -------------------------------------------------------------------------
  /**
   * Gated dispatch of an MCP tool call to mcp_excalidraw. Enforces the
   * curated allow-list (T8) and approval gate (T21) before invocation.
   * Implementation lands in T15.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async dispatchToolCall(_call: McpToolCall): Promise<McpToolResult> {
    throw todo('dispatchToolCall', 'T15', 1569)
  }

  // -------------------------------------------------------------------------
  // 3. translateElementId — T16
  // -------------------------------------------------------------------------
  /**
   * Translate an mcp_excalidraw element id into the canvas-store element id.
   * Backed by the `ElementIdMapping` cache. Implementation lands in T16.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  translateElementId(_mcpId: string): string {
    throw todo('translateElementId', 'T16', 1658)
  }

  // -------------------------------------------------------------------------
  // 4. syncStateFromCanvas — T14
  // -------------------------------------------------------------------------
  /**
   * Push current canvas-store state into mcp_excalidraw at session start so
   * the server has the same scene as the renderer. Implementation lands in
   * T14.
   */
  async syncStateFromCanvas(): Promise<void> {
    throw todo('syncStateFromCanvas', 'T14', 1480)
  }

  // -------------------------------------------------------------------------
  // 5. beginAiBatch — T17
  // -------------------------------------------------------------------------
  /**
   * Start an undo-grouping batch. Returns a `BatchToken` that must be
   * passed to `endAiBatch`. Implementation lands in T17.
   */
  beginAiBatch(): BatchToken {
    throw todo('beginAiBatch', 'T17', 1733)
  }

  // -------------------------------------------------------------------------
  // 6. endAiBatch — T17
  // -------------------------------------------------------------------------
  /**
   * Commit one history entry via Excalidraw `captureUpdate` for the batch
   * opened by `beginAiBatch`. Implementation lands in T17.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  endAiBatch(_token: BatchToken): void {
    throw todo('endAiBatch', 'T17', 1733)
  }

  // -------------------------------------------------------------------------
  // 7. handleProcessCrash — T14
  // -------------------------------------------------------------------------
  /**
   * Orchestrate restart of the mcp_excalidraw process and replay state.
   * Implementation lands in T14.
   */
  async handleProcessCrash(): Promise<void> {
    throw todo('handleProcessCrash', 'T14', 1480)
  }

  // -------------------------------------------------------------------------
  // 8. translateToolResult — T16
  // -------------------------------------------------------------------------
  /**
   * Translate a successful MCP tool result into a sequence of canvas-store
   * mutations. Implementation lands in T16.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  translateToolResult(_result: McpToolResult): CanvasMutation[] {
    throw todo('translateToolResult', 'T16', 1658)
  }

  // -------------------------------------------------------------------------
  // 9. applyTheme — T14
  // -------------------------------------------------------------------------
  /**
   * Apply Jan theme defaults (stroke / fill / background) to the supplied
   * Excalidraw elements. Implementation lands in T14.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyTheme(_elements: ExcalidrawElement[]): ExcalidrawElement[] {
    throw todo('applyTheme', 'T14', 1480)
  }

  // -------------------------------------------------------------------------
  // 10. lockManualEdits — T22
  // -------------------------------------------------------------------------
  /**
   * Acquire the manual-edit concurrency lock and return an unlock callback.
   * Implementation lands in T22.
   */
  lockManualEdits(): UnlockFn {
    throw todo('lockManualEdits', 'T22', 2180)
  }

  // -------------------------------------------------------------------------
  // 11. enforceCuratedToolList — T13 (REAL implementation)
  // -------------------------------------------------------------------------
  /**
   * Enforce the curated mcp_excalidraw allow-list (T8). One-line wrapper
   * around `filterAllowedTools` so the gate is enforceable from the moment
   * the orchestrator is constructed — even before T15 wires the dispatcher.
   *
   * This is the only responsibility with a real implementation in T13.
   */
  enforceCuratedToolList(tools: MCPTool[]): MCPTool[] {
    return filterAllowedTools(tools)
  }
}

// ---------------------------------------------------------------------------
// Type-only re-exports for convenience (callers should still import from
// `./types` for contract types — these are forwarded to keep T14–T17 import
// blocks short).
// ---------------------------------------------------------------------------
export type {
  McpToolCall,
  McpToolResult,
  ElementIdMapping,
  OrchestratorResponsibilityName,
}
