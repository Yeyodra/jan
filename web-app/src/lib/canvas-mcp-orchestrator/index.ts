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
  type CanvasMutation,
  type ExcalidrawElementLike,
} from './types'
import { filterAllowedTools } from './curated-tools'
import {
  resolveActiveCanvas as resolveActiveCanvasImpl,
  syncStateFromCanvas as syncStateFromCanvasImpl,
  type CanvasStoreLike,
  type McpClientLike,
  type RouterLike,
  type SyncLogger,
  type SyncOutcome,
} from './active-canvas'
import {
  dispatchExcalidrawTool,
  type ApprovalGateFn,
  type DispatchMcpClientLike,
} from './dispatch'
import { createIdTranslator, type IdTranslator } from './id-translation'
import { translateMcpToolResult } from './result-translator'

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
 * Re-export of the discriminated-union mutation type from `./types.ts`.
 * Concrete shape lives there as of T16. Kept here so existing
 * `import { CanvasMutation } from '.../canvas-mcp-orchestrator'` callers
 * continue to compile without churn.
 */
export type { CanvasMutation } from './types'

/**
 * Excalidraw-element placeholder, now backed by the structural type from
 * `./types.ts`. We can't import the real Excalidraw type at this layer (the
 * "does not import React, zustand, or Excalidraw at module load" test
 * forbids it). Adapters at the boundary may cast/widen.
 */
export type ExcalidrawElement = ExcalidrawElementLike

// ---------------------------------------------------------------------------
// Dependency contract
// ---------------------------------------------------------------------------

/**
 * Constructor dependencies for `CanvasMcpOrchestrator`.
 *
 * - `canvasStore`  — wired in T14 to a slice of `useCanvasStore`. Kept as
 *                    `unknown` at this slot for back-compat with T13's
 *                    construction-time tripwire test (which passes a Proxy
 *                    that throws on any property access). The T14 methods
 *                    that need the store (`syncStateFromCanvas`) narrow it
 *                    to `CanvasStoreLike` at the call site.
 * - `mcpClient`    — wired in T15 to the active mcp_excalidraw transport.
 *                    Same `unknown` rationale; narrowed at call sites in
 *                    T14 / T15.
 * - `router`       — optional TanStack-Router-shaped object for
 *                    `resolveActiveCanvas`. Omit in tests that don't need
 *                    routing; the resolver returns `null` when absent.
 * - `logger`       — optional sync/dispatch logger. Defaults to a noop.
 * - `themeProvider`— wired in T13.x or T14 once the theme contract lands.
 * - `telemetry`    — optional; defaults to `NoopTelemetry`.
 *
 * The store/client/theme slots remain `unknown` at the type level so the
 * T13 decoupling test (which constructs the orchestrator with a tripwire
 * Proxy) keeps passing. See the file-header "Decoupling stance" section.
 */
export type CanvasMcpOrchestratorDeps = {
  canvasStore: unknown
  mcpClient: unknown
  router?: RouterLike | null
  logger?: SyncLogger
  themeProvider?: unknown
  telemetry?: TelemetrySink
  /**
   * T21 approval-gate function. Wraps `useToolApproval.getState()
   * .showApprovalModal(...)` at the construction site. Function-shaped
   * so this module never imports the zustand store. When omitted,
   * mutating dispatch calls fail closed (see `./dispatch.ts`).
   *
   * Wired in T15.
   */
  approvalGate?: ApprovalGateFn
  /**
   * Active conversation thread id. Threaded into the approval gate so
   * T21 can scope auto-approvals per thread.
   *
   * Either pass via constructor (preferred for long-lived orchestrators)
   * or call `setThreadId(...)` once a session starts. The plan describes
   * "the orchestrator receives `threadId` when a session starts" — both
   * paths satisfy that contract.
   *
   * Wired in T15.
   */
  threadId?: string
  /**
   * Canvas-store-compatible id factory used by the T16 element-id
   * translator. When omitted, a `crypto.randomUUID`-backed default is
   * used that mirrors `web-app/src/stores/canvas-store.ts:112`. Tests
   * may inject a deterministic counter.
   *
   * Wired in T16.
   */
  generateId?: () => string
}

// ---------------------------------------------------------------------------
// Default canvas-id generator (T16)
// ---------------------------------------------------------------------------

/**
 * Default id factory mirroring `canvas-store.ts:112` `generateId`. We
 * REPLICATE the logic instead of importing because the orchestrator dir is
 * forbidden to pull the zustand store into its module graph (asserted by the
 * "does not import React, zustand, or Excalidraw at module load" test).
 *
 * Keep this in sync with `web-app/src/stores/canvas-store.ts:112-134` if the
 * canvas-store id format ever changes — there is no compile-time link.
 */
function defaultGenerateId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // RFC4122 v4 fallback (extremely unlikely path).
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
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
  /**
   * Opaque session token used to enforce one-shot idempotency on
   * `syncStateFromCanvas`. Each orchestrator instance owns one — that
   * matches the "session lifetime == orchestrator lifetime" assumption.
   * The token is a fresh object so two distinct orchestrator instances
   * sync independently.
   */
  private readonly sessionToken: object = {}
  /**
   * Active thread id. Initialised from `deps.threadId` and mutable via
   * `setThreadId(...)` so the orchestrator can outlive a single thread
   * and still route approvals to the correct conversation.
   */
  private threadId: string | undefined
  /**
   * Per-session bidirectional mcp ↔ canvas-store id translator (T16).
   * One instance per orchestrator. Reset via `idTranslator.clear()` on
   * session boundaries (currently called from `syncStateFromCanvas`'s
   * idempotency miss-path; T22 may add an explicit `resetSession()`).
   */
  protected readonly idTranslator: IdTranslator

  constructor(deps: CanvasMcpOrchestratorDeps) {
    this.deps = deps
    this.telemetry = deps.telemetry ?? NoopTelemetry
    this.threadId = deps.threadId
    this.idTranslator = createIdTranslator({
      generateId: deps.generateId ?? defaultGenerateId,
    })

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
   * Resolve the canvas-store id of the currently active canvas, or `null`
   * when no canvas is active or no router was injected.
   *
   * Delegates to the pure helper in `./active-canvas` so the logic stays
   * testable in isolation (`active-canvas.test.ts`). The router is read
   * via `deps.router`, which is typed `RouterLike | null` — the orchestrator
   * itself never imports `@tanstack/react-router`.
   */
  resolveActiveCanvas(): string | null {
    return resolveActiveCanvasImpl(this.deps.router ?? null)
  }

  // -------------------------------------------------------------------------
  // 2. dispatchToolCall — T15 (wired)
  // -------------------------------------------------------------------------
  /**
   * Gated dispatch of an MCP tool call to mcp_excalidraw. Enforces the
   * curated allow-list (T8) and approval gate (T21) before invocation.
   *
   * Delegates to the pure helper in `./dispatch` so the gate logic stays
   * testable in isolation. The approval gate is injected via
   * `deps.approvalGate` — when omitted, mutating calls fail closed.
   *
   * Never throws — failures (blocked tool, denied approval, transport
   * error) are surfaced as `{ error: '...' }` envelopes.
   */
  async dispatchToolCall(call: McpToolCall): Promise<McpToolResult> {
    return dispatchExcalidrawTool(call, {
      mcpClient: this.deps.mcpClient as DispatchMcpClientLike,
      approvalGate: this.deps.approvalGate,
      // Threading: prefer the live setter-updated value over the original
      // deps slot so `setThreadId(...)` after construction takes effect.
      threadId: this.threadId ?? '',
      logger: this.deps.logger,
      telemetry: this.telemetry,
    })
  }

  // NOTE: thread id mutation lives on `setThreadId` (instance arrow,
  // see below). It is intentionally NOT a prototype method so the
  // "prototype owns exactly the 11 responsibility methods" reflection
  // test in `index.test.ts` keeps passing.
  /**
   * Update the active thread id used by `dispatchToolCall` when threading
   * approvals. The plan describes the orchestrator "receiving threadId
   * when a session starts" — call this once per session.
   *
   * Defined as an instance arrow (assigned in the constructor) so it does
   * NOT pollute the prototype and break the responsibility-shape test.
   */
  setThreadId: (threadId: string) => void = (threadId) => {
    this.threadId = threadId
  }

  // -------------------------------------------------------------------------
  // 3. translateElementId — T16 (wired)
  // -------------------------------------------------------------------------
  /**
   * Translate an mcp_excalidraw element id into the canvas-store element id.
   * Allocates on first contact, returns the cached canvas id on repeat calls
   * (idempotent). Internally namespaces mcp ids with `mcp_` so a coincidental
   * collision with a canvas-store-issued id cannot silently merge two
   * logical elements.
   *
   * Delegates to `IdTranslator` (`./id-translation.ts`) so the bi-map logic
   * stays testable in isolation.
   */
  translateElementId(mcpId: string): string {
    return this.idTranslator.translateMcpToCanvas(mcpId)
  }

  /**
   * Reverse-translate a canvas-store element id back to its mcp id (or the
   * canvas id itself for user-registered identity entries). Returns
   * `undefined` for unregistered canvas ids — callers must register
   * user-created elements via `registerUserElement(...)` before reverse
   * lookups can succeed.
   *
   * Defined as an instance arrow (not a prototype method) so it does NOT
   * pollute the prototype and break the "exactly the 11 responsibility
   * methods" reflection test in `index.test.ts`.
   */
  reverseTranslateElementId: (canvasId: string) => string | undefined = (canvasId) =>
    this.idTranslator.translateCanvasToMcp(canvasId)

  /**
   * Register a user-created canvas element so its id is reverse-translatable
   * for downstream MCP requests that reference it. Identity mapping (Z → Z).
   * Idempotent.
   *
   * Defined as an instance arrow (not a prototype method) for the same
   * reason as `reverseTranslateElementId` above.
   */
  registerUserElement: (canvasId: string) => void = (canvasId) =>
    this.idTranslator.registerUserElement(canvasId)

  // -------------------------------------------------------------------------
  // 4. syncStateFromCanvas — T14
  // -------------------------------------------------------------------------
  /**
   * Push current canvas-store state into mcp_excalidraw at session start so
   * the server has the same scene as the renderer.
   *
   * Returns a `SyncOutcome` (skipped / imported / failed) instead of `void`
   * so callers and tests can introspect what happened. The plan's contract
   * is "never throw, degrade gracefully" — the helper enforces that.
   *
   * Idempotency: scoped to this orchestrator instance via the per-instance
   * `sessionToken`. The second call within the same orchestrator's lifetime
   * returns `{ status: 'skipped', reason: 'already-synced' }` without
   * touching the MCP transport.
   */
  async syncStateFromCanvas(): Promise<SyncOutcome> {
    return syncStateFromCanvasImpl({
      canvasId: this.resolveActiveCanvas(),
      store: this.deps.canvasStore as CanvasStoreLike,
      mcpClient: this.deps.mcpClient as McpClientLike,
      sessionToken: this.sessionToken,
      logger: this.deps.logger,
    })
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
  // 8. translateToolResult — T16 (wired)
  // -------------------------------------------------------------------------
  /**
   * Translate a successful MCP tool result into a sequence of canvas-store
   * mutations. Mcp element ids are translated through the per-session
   * `IdTranslator` so the returned mutations only carry canvas-store ids.
   *
   * Delegates to the pure helper in `./result-translator.ts`. Never throws
   * — failures (unrecognized tool, malformed payload, error envelope)
   * surface as `[{ kind: 'noop', reason: '...' }]`.
   *
   * For the second-level `translateToolResultByName(toolName, result)`
   * helper (preferred call site that knows the tool name), see the
   * instance-arrow method below.
   */
  translateToolResult(result: McpToolResult): CanvasMutation[] {
    return translateMcpToolResult(result, this.idTranslator, {
      telemetry: { increment: this.telemetry.increment.bind(this.telemetry) },
    })
  }

  /**
   * Variant of `translateToolResult` that takes the dispatching tool name.
   * Skips the prose-sniffing fallback in `result-translator.ts` and
   * dispatches by the explicit name. Use this from the call site that
   * knows the dispatched tool name (the orchestrator's own `dispatchToolCall`
   * caller).
   *
   * Defined as an instance arrow (not a prototype method) for the same
   * reason as `setThreadId` above — keeps the "11 responsibilities" shape
   * test passing.
   */
  translateToolResultByName: (
    toolName: string,
    result: McpToolResult,
  ) => CanvasMutation[] = (toolName, result) =>
    translateMcpToolResult(result, this.idTranslator, {
      toolName,
      telemetry: { increment: this.telemetry.increment.bind(this.telemetry) },
    })

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
