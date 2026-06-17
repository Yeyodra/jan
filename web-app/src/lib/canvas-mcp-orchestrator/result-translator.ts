/**
 * MCP tool-result → CanvasMutation[] translator (Wave 4, T16)
 * =============================================================
 *
 * Pure helper consumed by `CanvasMcpOrchestrator.translateToolResult`
 * (`./index.ts`).
 *
 * Wire shape (vendored mcp_excalidraw)
 * ------------------------------------
 * mcp_excalidraw returns tool results as
 *   `{ content: [{ type: 'text', text: <prose>'\n\n'<json>'\n\n'<status emoji> }] }`
 * The prose preamble is the only deterministic disambiguator on the wire —
 * there is no `op` field. We pin per-tool preambles from the vendored source
 * (`src-tauri/resources/mcp_excalidraw/src/index.ts`):
 *
 *   create_element        → "Element created successfully!"
 *   update_element        → "Element updated successfully!"
 *   delete_element        → "Element deleted successfully!"
 *   batch_create_elements → "<n> elements created successfully!"
 *
 * When the caller knows the tool name (preferred), pass `toolName` in
 * `options` to skip prose sniffing. The pinned prose is a fall-back used
 * for the dispatch-result path that has already lost the tool name.
 *
 * Mutation shape
 * --------------
 * See `./types.ts` → `CanvasMutation` for the discriminated union. Every
 * id surfaced in a mutation has been translated through the supplied
 * `IdTranslator` — mcp ids never leak past this boundary (plan §1671).
 *
 * Error / unrecognized handling
 * -----------------------------
 * Every failure path returns `[{ kind: 'noop', reason: '...' }]` so callers
 * can `.flatMap(...)` without length checks. Unrecognized tool names emit a
 * telemetry counter (`excalidraw.unrecognized_tool_result`) so we can
 * detect upstream tool additions that need a translator update.
 *
 * Style alignment
 * ---------------
 * Mirrors the structural-DI pattern of `./dispatch.ts` (T15):
 *   - pure function, never throws,
 *   - injected telemetry,
 *   - no React/zustand/Excalidraw/router imports at module top-level.
 */
import type {
  CanvasMutation,
  ExcalidrawElementLike,
  McpToolResult,
} from './types'
import type { IdTranslator } from './id-translation'

// ---------------------------------------------------------------------------
// Prose preamble → tool name (sniffed from vendored mcp_excalidraw source)
// ---------------------------------------------------------------------------

/** Single source of truth for the wire-shape prose preambles. */
const PREAMBLE_TO_TOOL: ReadonlyArray<{
  test: (firstLine: string) => boolean
  toolName: SupportedTool
}> = [
  {
    test: (l) => l === 'Element created successfully!',
    toolName: 'create_element',
  },
  {
    test: (l) => l === 'Element updated successfully!',
    toolName: 'update_element',
  },
  {
    test: (l) => l === 'Element deleted successfully!',
    toolName: 'delete_element',
  },
  {
    // batch_create_elements preamble is `${count} elements created successfully!`
    test: (l) => /^\d+ elements created successfully!$/.test(l),
    toolName: 'batch_create_elements',
  },
]

/** Tool names this translator knows how to map. */
type SupportedTool =
  | 'create_element'
  | 'update_element'
  | 'delete_element'
  | 'batch_create_elements'

// ---------------------------------------------------------------------------
// Telemetry sink (re-stated locally to keep this module decoupled)
// ---------------------------------------------------------------------------

/**
 * Telemetry sink contract. Same shape as `TelemetrySink` in `./index.ts` —
 * re-stated here so this module stays import-graph-independent.
 */
export type ResultTranslatorTelemetry = {
  increment: (metric: string) => void
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type TranslateMcpToolResultOptions = {
  /**
   * When the dispatch site knows the tool name, pass it here to bypass the
   * fragile prose-sniffing fallback. Recommended for production callers.
   */
  toolName?: string
  /** Optional telemetry sink. */
  telemetry?: ResultTranslatorTelemetry
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate one MCP tool result into the canvas-store mutation list.
 * Never throws — every failure mode returns a `noop` mutation with a
 * `reason` so callers can decide whether to log or surface to the user.
 */
export function translateMcpToolResult(
  result: McpToolResult,
  translator: IdTranslator,
  options: TranslateMcpToolResultOptions = {},
): CanvasMutation[] {
  // -------------------------------------------------------------------------
  // 1. Error envelope or empty content → noop
  // -------------------------------------------------------------------------
  if ('error' in result) {
    return [{ kind: 'noop', reason: `mcp error: ${result.error}` }]
  }
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return [{ kind: 'noop', reason: 'empty content' }]
  }
  const text = result.content[0]?.text
  if (typeof text !== 'string') {
    return [{ kind: 'noop', reason: 'no text content' }]
  }

  // -------------------------------------------------------------------------
  // 2. Resolve tool name (explicit > prose-sniffed)
  // -------------------------------------------------------------------------
  let resolvedTool: SupportedTool | undefined
  if (options.toolName !== undefined) {
    if (isSupportedTool(options.toolName)) {
      resolvedTool = options.toolName
    } else {
      // Caller asked for a tool we don't know — record telemetry so we can
      // detect upstream tool additions, then noop.
      options.telemetry?.increment('excalidraw.unrecognized_tool_result')
      return [
        {
          kind: 'noop',
          reason: `unrecognized tool: ${options.toolName}`,
        },
      ]
    }
  } else {
    // Sniff the first non-empty line of the text body.
    const firstLine = text.split('\n', 1)[0] ?? ''
    for (const entry of PREAMBLE_TO_TOOL) {
      if (entry.test(firstLine)) {
        resolvedTool = entry.toolName
        break
      }
    }
  }

  if (resolvedTool === undefined) {
    return [{ kind: 'noop', reason: 'unrecognized tool result preamble' }]
  }

  // -------------------------------------------------------------------------
  // 3. Extract JSON payload
  // -------------------------------------------------------------------------
  const payload = parseJsonPayload(text, options.toolName !== undefined)
  if (payload === null) {
    return [{ kind: 'noop', reason: 'failed to parse json payload' }]
  }

  // -------------------------------------------------------------------------
  // 4. Per-tool dispatch
  // -------------------------------------------------------------------------
  switch (resolvedTool) {
    case 'create_element':
      return translateCreate(payload, translator)
    case 'update_element':
      return translateUpdate(payload, translator)
    case 'delete_element':
      return translateDelete(payload, translator)
    case 'batch_create_elements':
      return translateBatchCreate(payload, translator)
  }
}

// ---------------------------------------------------------------------------
// Per-tool translators
// ---------------------------------------------------------------------------

function translateCreate(
  payload: unknown,
  translator: IdTranslator,
): CanvasMutation[] {
  if (!isObject(payload) || typeof payload.id !== 'string') {
    return [{ kind: 'noop', reason: 'create payload missing id' }]
  }
  const canvasId = translator.translateMcpToCanvas(payload.id)
  const element: ExcalidrawElementLike = {
    ...(payload as Record<string, unknown>),
    id: canvasId,
  }
  return [{ kind: 'add', elements: [element] }]
}

function translateUpdate(
  payload: unknown,
  translator: IdTranslator,
): CanvasMutation[] {
  if (!isObject(payload) || typeof payload.id !== 'string') {
    return [{ kind: 'noop', reason: 'update payload missing id' }]
  }
  const canvasId = translator.translateMcpToCanvas(payload.id)
  const patch: Partial<ExcalidrawElementLike> = {
    ...(payload as Record<string, unknown>),
    id: canvasId,
  }
  return [{ kind: 'update', ids: [canvasId], patch }]
}

function translateDelete(
  payload: unknown,
  translator: IdTranslator,
): CanvasMutation[] {
  if (!isObject(payload) || typeof payload.id !== 'string') {
    return [{ kind: 'noop', reason: 'delete payload missing id' }]
  }
  const canvasId = translator.translateMcpToCanvas(payload.id)
  return [{ kind: 'delete', ids: [canvasId] }]
}

function translateBatchCreate(
  payload: unknown,
  translator: IdTranslator,
): CanvasMutation[] {
  if (
    !isObject(payload) ||
    !Array.isArray((payload as { elements?: unknown }).elements)
  ) {
    return [{ kind: 'noop', reason: 'batch payload missing elements' }]
  }
  const rawElements = (payload as { elements: unknown[] }).elements
  const translated: ExcalidrawElementLike[] = []
  for (const raw of rawElements) {
    if (!isObject(raw) || typeof raw.id !== 'string') continue
    const canvasId = translator.translateMcpToCanvas(raw.id)
    translated.push({
      ...(raw as Record<string, unknown>),
      id: canvasId,
    })
  }
  if (translated.length === 0) {
    return [{ kind: 'noop', reason: 'batch produced no usable elements' }]
  }
  return [{ kind: 'add', elements: translated }]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSupportedTool(name: string): name is SupportedTool {
  return (
    name === 'create_element' ||
    name === 'update_element' ||
    name === 'delete_element' ||
    name === 'batch_create_elements'
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Pull the JSON object out of the wire text. Wire shape is
 *   `<prose>\n\n<json>\n\n<status>` for sniffed (preamble-prefixed) results,
 *   `<json>` for explicit-toolName results.
 *
 * @param text          — full text body from `content[0].text`
 * @param hasNoPreamble — true when caller supplied an explicit toolName
 *                        (we should treat the entire body as JSON).
 */
function parseJsonPayload(text: string, hasNoPreamble: boolean): unknown {
  // Explicit-toolName fast path: whole body is JSON.
  if (hasNoPreamble) {
    try {
      return JSON.parse(text)
    } catch {
      // Fall through to slice-based recovery in case the dispatch site
      // happened to forward the prose-decorated body.
    }
  }

  // Sniffed path: skip the preamble, keep everything up to the trailing
  // status line. The vendored format separates with `\n\n`. We slice out
  // the longest run that parses as JSON.
  const firstSep = text.indexOf('\n\n')
  if (firstSep < 0) return null
  // Find the final `\n\n` so we can drop the trailing status emoji line.
  const lastSep = text.lastIndexOf('\n\n')
  const candidate =
    lastSep > firstSep
      ? text.slice(firstSep + 2, lastSep)
      : text.slice(firstSep + 2)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}
