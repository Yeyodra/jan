/**
 * Bidirectional mcp ↔ canvas-store id translator (Wave 4, T16)
 * ==============================================================
 *
 * Pure-data helper consumed by `CanvasMcpOrchestrator.translateElementId`
 * and by `translateMcpToolResult` (`./result-translator.ts`).
 *
 * Why this lives in its own module
 * --------------------------------
 *  - The orchestrator dir is forbidden to pull React, zustand, Excalidraw,
 *    or `@tanstack/react-router` into its module graph (asserted by
 *    `index.test.ts` → "does not import React, zustand, or Excalidraw at
 *    module load"). A pure factory file keeps T16 testable without spinning
 *    up a browser or the canvas-store.
 *  - The translator is per-session state; isolating it lets the orchestrator
 *    own one instance per session and reset on session boundaries via
 *    `clear()` — without that boundary, mappings would leak across threads.
 *
 * Design — bidirectional + namespacing
 * ------------------------------------
 *  - Forward map: `Map<namespacedMcpId, canvasId>` — see `MCP_ID_PREFIX`.
 *    Ids coming over the MCP wire are namespaced internally by prepending
 *    `mcp_` BEFORE storage. Callers always pass the raw mcp id; the prefix
 *    is invisible at the API surface.
 *  - Reverse map: `Map<canvasId, namespacedMcpId | canvasId>` — for user-
 *    registered (identity) entries the value is the canvas id itself; for
 *    MCP-allocated entries the value is the namespaced mcp id. We strip the
 *    `mcp_` prefix on read so callers see the original raw mcp id.
 *
 * Why namespace
 * -------------
 * mcp_excalidraw issues element ids via its own `generateId()` (UUID-shape).
 * canvas-store ALSO uses UUID-shape ids. Without namespacing the forward map
 * key, a coincidental collision would silently merge two different logical
 * elements into one mapping. The plan §1666 explicitly calls this out:
 *   "namespace mcp ids internally with prefix `mcp_` before mapping".
 *
 * Identity mapping (user-created elements)
 * ----------------------------------------
 * `registerUserElement(z)` makes Z visible to the LLM under the same id
 * (`Z → Z`). The forward map stores the *raw* canvas id (no namespace) so
 * the LLM-side translateMcpToCanvas('z') hits the identity path. The
 * reverse map stores `z → z` so the orchestrator can render LLM-issued
 * mcp-result elements that reference the user's element correctly.
 *
 * Lifecycle
 * ---------
 * One instance per orchestrator session. Reset via `clear()` from the
 * orchestrator on session boundaries (see `syncStateFromCanvas` and any
 * future `resetSession()` from T22). NEVER persist beyond session — the
 * plan §1673 forbids it ("rebuilds on each session start").
 *
 * Style alignment
 * ---------------
 * Mirrors the structural-DI pattern from `./active-canvas.ts` (T14) and
 * `./dispatch.ts` (T15): `createX(deps)` factory, no module-level mutable
 * state, no top-level imports of React/zustand/Excalidraw/router.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Internal prefix applied to every mcp id BEFORE it lands in the forward
 * map. Exported so `id-translation.test.ts` can assert the value and so
 * downstream code can avoid building canvas ids that accidentally start
 * with this prefix (no current consumer does — canvas-store uses
 * `crypto.randomUUID()` which never starts with `mcp_`).
 */
export const MCP_ID_PREFIX = 'mcp_'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Generator-only DI surface. The translator does NOT import canvas-store —
 * the caller is responsible for handing in a function that returns
 * canvas-store-compatible unique ids. The default in `index.ts` mirrors
 * `canvas-store.ts:112` (UUID via `crypto.randomUUID`) without importing
 * the zustand store.
 */
export type IdTranslatorDeps = {
  /**
   * Returns a fresh canvas-store-compatible id. Must produce unique values
   * across the lifetime of one translator instance.
   */
  generateId: () => string
}

/**
 * Public surface of the translator. Methods are arrow-style so the instance
 * can be passed by reference (e.g. into the result-translator) without
 * losing `this`.
 */
export type IdTranslator = {
  /**
   * Allocate (on first call) or fetch (on repeat call) the canvas-store id
   * for the supplied raw mcp id. Idempotent — subsequent calls with the
   * same input return the same canvas id without invoking `generateId`.
   *
   * Callers MUST pass the raw mcp id (NOT prefixed). The translator adds
   * the `mcp_` namespace prefix internally.
   */
  translateMcpToCanvas: (mcpId: string) => string

  /**
   * Reverse lookup: given a canvas-store id, return the raw mcp id (or the
   * canvas id itself for user-registered identity entries). Returns
   * `undefined` if the canvas id has not been registered or allocated by
   * this translator.
   *
   * The returned value never carries the `mcp_` prefix — callers see the
   * same shape they originally passed in (or the user's identity id).
   */
  translateCanvasToMcp: (canvasId: string) => string | undefined

  /**
   * Register a user-created element so the LLM can reference it. Identity
   * mapping: forward-translates raw `canvasId` → `canvasId`, reverse-
   * translates `canvasId` → `canvasId`. No allocator call; idempotent.
   */
  registerUserElement: (canvasId: string) => void

  /**
   * Empty both directions. Called on session boundaries — e.g. after
   * `syncStateFromCanvas` re-imports the scene from canvas-store and the
   * mcp_excalidraw server's id space resets.
   */
  clear: () => void

  /**
   * Number of unique mappings currently held. Useful for telemetry and
   * test assertions. Counts each (forward) key once — duplicates and
   * idempotent re-registrations do not inflate the count.
   */
  size: () => number
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fresh per-session translator. See file header for the bi-map
 * design and the namespacing rule.
 */
export function createIdTranslator(deps: IdTranslatorDeps): IdTranslator {
  // Forward map.
  //   key   — namespaced mcp id (`mcp_<raw>`) for MCP-sourced entries,
  //           OR plain canvas id for user-registered identity entries.
  //   value — canvas-store id.
  const forward = new Map<string, string>()
  // Reverse map.
  //   key   — canvas-store id.
  //   value — namespaced mcp id for MCP-sourced entries, OR plain canvas id
  //           for user-registered identity entries.
  const reverse = new Map<string, string>()

  const namespacedMcp = (raw: string): string => MCP_ID_PREFIX + raw

  const translateMcpToCanvas = (mcpId: string): string => {
    const key = namespacedMcp(mcpId)
    const cached = forward.get(key)
    if (cached !== undefined) return cached
    const canvasId = deps.generateId()
    forward.set(key, canvasId)
    reverse.set(canvasId, key)
    return canvasId
  }

  const translateCanvasToMcp = (canvasId: string): string | undefined => {
    const stored = reverse.get(canvasId)
    if (stored === undefined) return undefined
    if (stored.startsWith(MCP_ID_PREFIX)) {
      return stored.slice(MCP_ID_PREFIX.length)
    }
    // Identity entry (user-registered): the stored value is the canvas id.
    return stored
  }

  const registerUserElement = (canvasId: string): void => {
    if (forward.has(canvasId)) return // idempotent
    forward.set(canvasId, canvasId)
    reverse.set(canvasId, canvasId)
  }

  const clear = (): void => {
    forward.clear()
    reverse.clear()
  }

  const size = (): number => forward.size

  return {
    translateMcpToCanvas,
    translateCanvasToMcp,
    registerUserElement,
    clear,
    size,
  }
}
