/**
 * AI-batch undo grouping via Excalidraw `captureUpdate` (Wave 4, T17)
 * ====================================================================
 *
 * Pure-DI helper consumed by `CanvasMcpOrchestrator.beginAiBatch /
 * endAiBatch / applyDuringBatch / forceEndBatch`.
 *
 * Contract (verbatim from plan §1733 + spike T3):
 *
 *   1. `begin()` returns an opaque `BatchToken`. Within the batch every
 *      `applyDuringBatch(elements)` call paints intermediate state via
 *      `excalidrawAPI.updateScene({ elements, captureUpdate: 'NEVER' })`
 *      so Excalidraw silently advances its store snapshot WITHOUT pushing
 *      a history entry.
 *
 *   2. `end(token)` validates the token and commits a single history
 *      entry via `excalidrawAPI.updateScene({ elements: lastKnownGoodState,
 *      captureUpdate: 'IMMEDIATELY' })`. The pattern `N × NEVER →
 *      1 × IMMEDIATELY` collapses an arbitrary AI tool batch into a single
 *      undo step (see `.sisyphus/spikes/03-captureUpdate.md` for the
 *      upstream JSDoc that gates this behaviour).
 *
 *   3. Concurrency: nested `begin()` while in flight returns the EXISTING
 *      token + emits a warning (single-level batching only — plan §1747).
 *
 *   4. Failure handling: if any `applyDuringBatch` call throws, the batch
 *      stays in flight and the LAST KNOWN GOOD element-set is retained
 *      so `end()` can still commit cleanly. This is the "don't leave
 *      orchestrator in zombie batch mode" guarantee from §1742.
 *
 *   5. `forceEnd()` is the emergency drain. While in flight, commits with
 *      lastKnownGoodState; while idle, is a safe no-op. Used by the
 *      orchestrator when an AI session aborts before `end()` was reached.
 *
 * Style alignment
 * ---------------
 * Mirrors the structural-DI factory pattern from `./active-canvas.ts` (T14),
 * `./dispatch.ts` (T15), and `./id-translation.ts` (T16):
 *   - `*-Like` types for the imperative API / logger / telemetry
 *   - Pure factory `createBatchController(deps): BatchController`
 *   - NO `@excalidraw/excalidraw`, React, zustand, or router imports at
 *     module top-level. The CaptureUpdateAction enum is mirrored locally
 *     as a `const` of string literals (the spike-confirmed wire values).
 *
 * @see .sisyphus/spikes/03-captureUpdate.md
 * @see web-app/src/lib/canvas-mcp-orchestrator/index.ts (consumer)
 */

import type { BatchToken } from './index'
import type { ExcalidrawElementLike } from './types'

// ---------------------------------------------------------------------------
// CaptureUpdateAction wire values — local mirror (spike T3)
// ---------------------------------------------------------------------------

/**
 * Local mirror of `CaptureUpdateAction` from `@excalidraw/excalidraw`.
 *
 * Wire values confirmed against `web-app/node_modules/@excalidraw/excalidraw
 * /dist/types/excalidraw/store.d.ts` (lines 7-39) — see spike T3 for the
 * verbatim quote and the table of effects on the history stack.
 *
 * We mirror the enum LOCALLY as a `const` of string literals so this module
 * does NOT have to import the runtime enum at module top-level. Keeping the
 * import out preserves the orchestrator dir's "does not import React,
 * zustand, or Excalidraw at module load" invariant (asserted by
 * `index.test.ts`).
 *
 * If the upstream wire values ever change, the `excalidrawAPI.updateScene`
 * call will fail at runtime with a clear MCP-side error — the spike
 * documents these as a stable public API surface.
 */
export const CAPTURE_UPDATE = {
  /** Calls `store.captureIncrement(...)` → ONE new undo entry. */
  IMMEDIATELY: 'IMMEDIATELY',
  /** Calls `store.updateSnapshot(...)` → snapshot advances, NO history. */
  NEVER: 'NEVER',
  /** Gated out at `App.updateScene` — realized at the next IMMEDIATELY. */
  EVENTUALLY: 'EVENTUALLY',
} as const

export type CaptureUpdateValue =
  (typeof CAPTURE_UPDATE)[keyof typeof CAPTURE_UPDATE]

// ---------------------------------------------------------------------------
// Structural DI contracts (no concrete imports)
// ---------------------------------------------------------------------------

/**
 * Narrowest slice of `ExcalidrawImperativeAPI` we depend on. The real
 * `updateScene` accepts `SceneData` (see
 * `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts`
 * L464-469); we model it structurally with `unknown` for the payload to
 * avoid pulling Excalidraw types into the orchestrator's module graph.
 *
 * The adapter at the wiring boundary (T18+ chat-dispatcher / CanvasEditor)
 * is responsible for confirming the cast at the call site.
 */
export type ExcalidrawApiLike = {
  updateScene: (sceneData: {
    elements: ExcalidrawElementLike[]
    captureUpdate: CaptureUpdateValue
  }) => void
}

/**
 * Logger contract. Same shape as T14/T15/T16 to keep DI ergonomics
 * consistent across the orchestrator package.
 */
export type BatchLogger = {
  debug?: (msg: string, meta?: Record<string, unknown>) => void
  warn?: (msg: string, meta?: Record<string, unknown>) => void
}

/**
 * Telemetry sink contract. Mirrors `TelemetrySink` in `./index.ts`,
 * re-stated here so this module stays import-graph-independent.
 */
export type BatchTelemetry = {
  increment: (metric: string) => void
  timing?: (metric: string, ms: number) => void
}

/**
 * Inputs for one batch-controller instance. Construct one per orchestrator.
 */
export type BatchControllerDeps = {
  /**
   * Excalidraw imperative API. When `undefined`, all batch operations are
   * fail-closed no-ops + log a warning + emit telemetry — consistent with
   * the T15 missing-gate semantics. The orchestrator wires this in once
   * the renderer mounts; tests omit it to assert fail-closed behaviour.
   */
  excalidrawAPI: ExcalidrawApiLike | undefined
  /** Optional logger. Warnings on nested-begin / mismatched-end / api-missing. */
  logger?: BatchLogger
  /** Optional telemetry sink. Counters under `batch.*`. */
  telemetry?: BatchTelemetry
  /**
   * Token factory. Returns a fresh, unique `BatchToken` per call. The
   * orchestrator injects a `Symbol`-based factory (matches the type
   * declared in `./index.ts` — `symbol & { __brand: 'CanvasMcpBatchToken' }`).
   */
  generateBatchToken: () => BatchToken
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Public API of one batch controller.
 */
export type BatchController = {
  /**
   * Open a new AI batch and return its token. If a batch is already in
   * flight, returns the EXISTING token (single-level batching) and logs
   * a warning. Always returns a token so call sites stay branch-free.
   */
  begin: () => BatchToken
  /**
   * Close the batch identified by `token`. Mismatched / unknown / no-batch
   * tokens are no-op + warn. On success, commits ONE history entry via
   * `updateScene({ ..., captureUpdate: 'IMMEDIATELY' })` carrying the last
   * known good element-set.
   */
  end: (token: BatchToken) => void
  /**
   * Apply intermediate elements during a batch. Calls `updateScene` with
   * `captureUpdate: 'NEVER'` so Excalidraw advances its snapshot silently
   * (no history entry). Internal errors are logged + counted; the batch
   * stays in flight (zombie recovery — `end()` will still commit).
   *
   * No-op + warn outside of a batch (call site bug).
   */
  applyDuringBatch: (elements: ExcalidrawElementLike[]) => void
  /**
   * Emergency drain. While in flight, commits with lastKnownGoodState
   * (always reaches IMMEDIATELY); while idle, safe no-op. Used by the
   * orchestrator when an AI session aborts (process crash, unmount, user
   * cancel) before `end()` was reached.
   */
  forceEnd: () => void
  /** Convenience predicate; equivalent to "a batch is currently open". */
  isInBatch: () => boolean
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a fresh `BatchController`. Closure-encapsulated state so every
 * orchestrator instance owns its own batch lifecycle.
 */
export function createBatchController(
  deps: BatchControllerDeps,
): BatchController {
  const { excalidrawAPI, logger, telemetry, generateBatchToken } = deps

  // ----- closure state ------------------------------------------------------
  let activeToken: BatchToken | null = null
  let lastKnownGoodState: ExcalidrawElementLike[] = []

  // ----- helpers ------------------------------------------------------------
  const tally = (metric: string): void => {
    telemetry?.increment(metric)
  }
  const warn = (msg: string, meta?: Record<string, unknown>): void => {
    logger?.warn?.(msg, meta)
  }

  /**
   * Reset to idle state. Always safe to call; used after end + forceEnd
   * + commit-error recovery.
   */
  const reset = (): void => {
    activeToken = null
    lastKnownGoodState = []
  }

  /**
   * Run the IMMEDIATELY commit. Caller is responsible for resetting state.
   * Errors are caught + logged + counted so callers can always reach reset.
   */
  const commitImmediately = (
    elements: ExcalidrawElementLike[],
  ): void => {
    if (!excalidrawAPI) {
      warn('canvas-mcp-orchestrator: batch commit skipped — no excalidrawAPI')
      tally('batch.api_missing')
      return
    }
    try {
      excalidrawAPI.updateScene({
        elements,
        captureUpdate: CAPTURE_UPDATE.IMMEDIATELY,
      })
    } catch (err) {
      warn('canvas-mcp-orchestrator: batch commit threw; clearing state', {
        error: err instanceof Error ? err.message : String(err),
      })
      tally('batch.commit_error')
    }
  }

  // ----- public methods -----------------------------------------------------
  const begin: BatchController['begin'] = () => {
    if (!excalidrawAPI) {
      warn(
        'canvas-mcp-orchestrator: beginAiBatch called without excalidrawAPI; batch ops will be no-ops',
      )
      tally('batch.api_missing')
      // Allocate a token anyway so callers don't have to special-case this
      // path. `applyDuringBatch` / `end` will see the missing API and warn.
      activeToken = generateBatchToken()
      lastKnownGoodState = []
      return activeToken
    }
    if (activeToken !== null) {
      // Single-level batching only (plan §1747). Return the existing token.
      warn(
        'canvas-mcp-orchestrator: nested beginAiBatch rejected; returning existing token',
      )
      tally('batch.nested_begin')
      return activeToken
    }
    activeToken = generateBatchToken()
    lastKnownGoodState = []
    return activeToken
  }

  const applyDuringBatch: BatchController['applyDuringBatch'] = (elements) => {
    if (activeToken === null) {
      warn(
        'canvas-mcp-orchestrator: applyDuringBatch called outside of a batch',
      )
      tally('batch.apply_outside_batch')
      return
    }
    if (!excalidrawAPI) {
      // Already warned at begin-time; emit telemetry but don't spam warnings.
      tally('batch.api_missing')
      // Still track the intended state so end() can dump it.
      lastKnownGoodState = elements
      return
    }
    try {
      excalidrawAPI.updateScene({
        elements,
        captureUpdate: CAPTURE_UPDATE.NEVER,
      })
      // Only update lastKnownGoodState on a successful paint — failed
      // intermediate writes must not corrupt the recovery snapshot.
      lastKnownGoodState = elements
    } catch (err) {
      warn(
        'canvas-mcp-orchestrator: applyDuringBatch threw; batch remains in flight',
        { error: err instanceof Error ? err.message : String(err) },
      )
      tally('batch.apply_error')
      // Do NOT clear activeToken — caller can keep dispatching; end() will
      // commit with whatever lastKnownGoodState we already have.
    }
  }

  const end: BatchController['end'] = (token) => {
    if (activeToken === null) {
      warn(
        'canvas-mcp-orchestrator: endAiBatch called without an active batch',
      )
      tally('batch.end_without_begin')
      return
    }
    if (token !== activeToken) {
      warn(
        'canvas-mcp-orchestrator: endAiBatch token mismatch; ignoring (batch left open)',
      )
      tally('batch.end_token_mismatch')
      return
    }
    const finalState = lastKnownGoodState
    // Reset BEFORE commit so a thrown commit (rare) cannot leave us in
    // zombie state. `commitImmediately` swallows + counts internal errors.
    reset()
    commitImmediately(finalState)
  }

  const forceEnd: BatchController['forceEnd'] = () => {
    if (activeToken === null) {
      // Idle — safe no-op.
      return
    }
    warn(
      'canvas-mcp-orchestrator: forceEnd draining in-flight batch (zombie recovery)',
    )
    tally('batch.force_end')
    const finalState = lastKnownGoodState
    reset()
    commitImmediately(finalState)
  }

  const isInBatch: BatchController['isInBatch'] = () => activeToken !== null

  return { begin, end, applyDuringBatch, forceEnd, isInBatch }
}
