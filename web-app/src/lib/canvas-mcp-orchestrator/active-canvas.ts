/**
 * Active-canvas resolution + state sync (Wave 4, T14)
 * ====================================================
 *
 * Two pure helpers consumed by `CanvasMcpOrchestrator` (`./index.ts`):
 *
 *   - `resolveActiveCanvas(routerLike)` — read TanStack Router's current
 *     match list and return the `canvasId` param when the active route is
 *     `/canvas/$canvasId`. Returns `null` otherwise.
 *
 *   - `syncStateFromCanvas(deps)` — push the active canvas's elements into
 *     mcp_excalidraw via a single `import_scene` (`mode: 'replace'`) call
 *     so the LLM sees the same scene the user is editing. Empty scene =
 *     no-op (mcp_excalidraw rejects empty imports — see below). Failure =
 *     logged and swallowed; the LLM continues against an empty server-side
 *     state.
 *
 * Why pure helpers (not hooks/store-readers)
 * ------------------------------------------
 * The orchestrator module is forbidden to import React, zustand, Excalidraw,
 * or `@tanstack/react-router` at module load (asserted by `index.test.ts`).
 * Pulling those in would also make the orchestrator un-testable in bun-test
 * without spinning up a browser. We accept the relevant slices as injected
 * arguments instead — the route component (T18 prompt bar) is responsible
 * for constructing the router/store views and handing them in.
 *
 * Why `import_scene` mode = 'replace'
 * -----------------------------------
 * The session-start contract is "make the server-side scene match the
 * client-side scene". Anything previously living in the mcp server's
 * in-memory canvas from a prior session must go. `replace` is the only mode
 * that gives us that guarantee in one round trip.
 *
 * Empty-canvas semantics (DECISION — see notepads/decisions.md)
 * -------------------------------------------------------------
 * mcp_excalidraw's `import_scene` handler throws `"No elements found in the
 * import data"` whenever the elements array is empty (see
 * `src-tauri/resources/mcp_excalidraw/dist/index.js:1400-1402`). Calling it
 * with `elements: []` would degrade gracefully (we already swallow errors)
 * but it would also pollute the telemetry/logs with a known no-op error on
 * every empty-session start. We therefore short-circuit BEFORE the wire call
 * when elements is empty — no `mcpClient.callTool` invocation at all, no
 * error log. The orchestrator records the no-op via the injected logger at
 * `debug` level so test harnesses can still assert "sync was attempted".
 *
 * Idempotency
 * -----------
 * The plan requires that double-calling `syncStateFromCanvas` within one
 * session only invokes `import_scene` once. We model "one session" via a
 * caller-supplied `sessionToken` (any value — typically a thread id or a
 * symbol). The helper keeps a tiny `WeakSet`-like set of tokens it has
 * already serviced; the second call for the same token returns immediately.
 * The set is module-scoped because the orchestrator is constructed per
 * session and the token is opaque — there is no cross-test leakage as long
 * as tests use distinct tokens (which they do).
 *
 * Style alignment
 * ---------------
 * Same shape as `web-app/src/lib/canvas/dispatch.ts` (T1.5): dependency
 * injection via a `deps` argument, never-throw contract (swallow + log),
 * and JSDoc explaining the WHY.
 */
import type { Canvas, CanvasElement } from '@/types/canvas'
import type { McpToolCall, McpToolResult } from './types'

// ---------------------------------------------------------------------------
// Router-shape contract (structural, not nominal)
// ---------------------------------------------------------------------------

/**
 * The narrowest slice of TanStack Router's runtime API we depend on.
 *
 * We accept any object with `.state.matches[]`, each match carrying a
 * `routeId` string and a `params` bag. This matches both the live router
 * instance and the synthetic fixtures used by tests — without dragging
 * `@tanstack/react-router` into this module's import graph.
 *
 * `routeId` for the canvas detail route is `/canvas/$canvasId` (the file
 * path TanStack derives from `routes/canvas/$canvasId.tsx`).
 */
export type RouterLike = {
  state: {
    matches: ReadonlyArray<{
      routeId: string
      params: Record<string, string | undefined>
    }>
  }
}

/** Route id of the canvas detail route. Single source of truth. */
export const CANVAS_DETAIL_ROUTE_ID = '/canvas/$canvasId'

// ---------------------------------------------------------------------------
// resolveActiveCanvas
// ---------------------------------------------------------------------------

/**
 * Pull the active canvas id from a TanStack-Router-shaped object.
 *
 * @returns the `canvasId` param when one of the current matches is the
 *          canvas detail route; `null` otherwise (including when the router
 *          argument itself is null/undefined or has no matches).
 */
export function resolveActiveCanvas(router: RouterLike | null | undefined): string | null {
  if (!router) return null
  const matches = router.state?.matches
  if (!matches || matches.length === 0) return null

  // Iterate so that nested layouts (e.g. /canvas/$canvasId/edit) still
  // resolve to the canvasId from the parent match.
  for (const m of matches) {
    if (m.routeId === CANVAS_DETAIL_ROUTE_ID) {
      const id = m.params?.canvasId
      return typeof id === 'string' && id.length > 0 ? id : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// syncStateFromCanvas
// ---------------------------------------------------------------------------

/**
 * The narrowest slice of `useCanvasStore` we depend on for sync.
 *
 * Accept a `getCanvas(id)` getter so callers can pass either the live
 * `useCanvasStore.getState().get` or a test fake without coupling us to
 * zustand.
 */
export type CanvasStoreLike = {
  getCanvas: (id: string) => Canvas | undefined
}

/**
 * The narrowest slice of an MCP transport we depend on. We do not import
 * any concrete transport here — that wiring lands in T15. The contract is
 * "call a tool by name with arguments, get back a result envelope".
 */
export type McpClientLike = {
  callTool: (call: McpToolCall) => Promise<McpToolResult>
}

/**
 * Logger contract. Defaults to `console` in `index.ts`; tests inject a
 * spy. Three levels match the existing Jan logging patterns used in the
 * canvas package.
 */
export type SyncLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
}

export type SyncStateFromCanvasDeps = {
  /** Active canvas id — usually `resolveActiveCanvas(router)`. */
  canvasId: string | null
  /** Read-only view of the canvas store. */
  store: CanvasStoreLike
  /** MCP transport that speaks mcp_excalidraw. */
  mcpClient: McpClientLike
  /** Opaque token identifying the current orchestrator session. */
  sessionToken: object | string | symbol
  /** Optional injected logger. Defaults to a noop. */
  logger?: SyncLogger
}

/** Outcome surface for `syncStateFromCanvas`. Useful for tests & telemetry. */
export type SyncOutcome =
  | { status: 'skipped'; reason: 'no-active-canvas' | 'canvas-missing' | 'empty-canvas' | 'already-synced' }
  | { status: 'imported'; elementCount: number }
  | { status: 'failed'; error: string }

// Module-scoped idempotency tracker. We use a Set keyed by the opaque
// session token. Object/symbol tokens are eligible for GC once the test
// (or the runtime session) drops its last reference — and string tokens
// are bounded by the test count, so this stays small.
const syncedSessions = new WeakSet<object>()
const syncedStringTokens = new Set<string>()

/**
 * Test-only reset hook. Lets `active-canvas.test.ts` start each test from a
 * known idempotency state without exporting the internal sets directly.
 * Production callers must not call this — name is unambiguous.
 */
export function __resetSyncedSessionsForTests(): void {
  syncedStringTokens.clear()
  // WeakSet has no `clear()`; existing object tokens are dropped by GC once
  // the test drops its reference. Tests should always use unique tokens.
}

function hasBeenSynced(token: object | string | symbol): boolean {
  if (typeof token === 'string') return syncedStringTokens.has(token)
  if (typeof token === 'object' && token !== null) return syncedSessions.has(token)
  // symbols can't go in a WeakSet pre-ES2023; treat each as fresh by
  // recording its `description` in the string set.
  return syncedStringTokens.has(`sym:${(token as symbol).description ?? String(token)}`)
}

function markSynced(token: object | string | symbol): void {
  if (typeof token === 'string') {
    syncedStringTokens.add(token)
    return
  }
  if (typeof token === 'object' && token !== null) {
    syncedSessions.add(token)
    return
  }
  syncedStringTokens.add(`sym:${(token as symbol).description ?? String(token)}`)
}

/**
 * Serialize the active canvas into mcp_excalidraw via `import_scene`.
 *
 * Contract:
 *   - Never throws. All failure modes return a `SyncOutcome` describing the
 *     skip / error.
 *   - Calls `mcpClient.callTool` AT MOST ONCE per session token.
 *   - Empty / missing canvas → no wire call, no error log.
 */
export async function syncStateFromCanvas(
  deps: SyncStateFromCanvasDeps,
): Promise<SyncOutcome> {
  const logger: SyncLogger = deps.logger ?? noopLogger
  const { canvasId, store, mcpClient, sessionToken } = deps

  if (hasBeenSynced(sessionToken)) {
    logger.debug('syncStateFromCanvas: skipping — session already synced')
    return { status: 'skipped', reason: 'already-synced' }
  }

  if (!canvasId) {
    logger.debug('syncStateFromCanvas: skipping — no active canvas')
    markSynced(sessionToken)
    return { status: 'skipped', reason: 'no-active-canvas' }
  }

  const canvas = store.getCanvas(canvasId)
  if (!canvas) {
    logger.debug('syncStateFromCanvas: skipping — canvas not found', { canvasId })
    markSynced(sessionToken)
    return { status: 'skipped', reason: 'canvas-missing' }
  }

  const elements = canvas.elements as readonly CanvasElement[]
  if (elements.length === 0) {
    // mcp_excalidraw's import_scene REJECTS empty arrays (see file header).
    // Short-circuit so we don't pollute logs with a known no-op error.
    logger.debug('syncStateFromCanvas: skipping — empty canvas', { canvasId })
    markSynced(sessionToken)
    return { status: 'skipped', reason: 'empty-canvas' }
  }

  // Build the .excalidraw-JSON payload `import_scene` expects. The handler
  // accepts both raw arrays and `{ elements, appState, files }` objects;
  // we pass the object form so any future fields (files / appState) flow
  // through without changes here.
  const scenePayload = {
    type: 'excalidraw',
    version: 2,
    source: 'jan-canvas-mcp-orchestrator',
    elements,
    appState: canvas.appState ?? {},
    files: canvas.files ?? {},
  }

  // Mark BEFORE awaiting so a re-entrant call during the in-flight import
  // (e.g. user clicks the button twice fast) is treated as a duplicate and
  // does not stack a second import.
  markSynced(sessionToken)

  try {
    const result = await mcpClient.callTool({
      name: 'import_scene',
      arguments: {
        mode: 'replace',
        data: JSON.stringify(scenePayload),
      },
    })

    // The result is the discriminated union from ./types. The error branch
    // means the server rejected — surface it through telemetry but still
    // do not throw.
    if ('error' in result) {
      logger.warn('syncStateFromCanvas: import_scene returned error', {
        canvasId,
        error: result.error,
      })
      return { status: 'failed', error: result.error }
    }

    logger.debug('syncStateFromCanvas: imported', {
      canvasId,
      elementCount: elements.length,
    })
    return { status: 'imported', elementCount: elements.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('syncStateFromCanvas: import_scene threw', {
      canvasId,
      error: message,
    })
    return { status: 'failed', error: message }
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const noopLogger: SyncLogger = {
  debug: () => {},
  warn: () => {},
}
