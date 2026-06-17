/**
 * Curated tool allow-list for mcp_excalidraw (T8).
 *
 * mcp_excalidraw at the vendored SHA (`c12ff87f6d607ccac7b217ae415bee8d855a067e`,
 * captured in `.sisyphus/evidence/task-2-bun-tools-list.json`) advertises
 * exactly **26** tools via the `tools/list` JSON-RPC method. Of those:
 *
 *   - 24 are surfaced to Jan's LLM         (`EXCALIDRAW_ALLOWED_TOOLS`)
 *   -  2 are HARD-BLOCKED at the boundary (`EXCALIDRAW_BLOCKED_TOOLS`)
 *
 * Within the 24 allowed tools, the orchestrator (T13–T15) gates execution via
 * `requiresApproval()` — `true` means a T21 user-approval prompt is required
 * before invocation; `false` means the tool is safe to auto-approve.
 *
 * Reconciliation note (26 vs 30)
 * ------------------------------
 * T4's spawn measurement (`.sisyphus/evidence/task-4-spawn-summary.json`)
 * reported "30 tools". That was a counting heuristic over `"name"` substrings
 * in the serialized JSON — which also matches `inputSchema.properties.<name>`
 * keys, NOT just tool names. The canonical, wire-accurate count is **26**,
 * derived from `tools[].name` in T2's captured `tools/list` response.
 *
 * Design constraints (plan §T8 lines 1007–1089)
 * --------------------------------------------
 *   1. Mutating vs read-only is enumerated EXPLICITLY. No regex / name
 *      patterns — a future tool added by upstream MUST be classified by hand,
 *      not silently bucketed by string match.
 *   2. The allow-list is CLOSED. `filterAllowedTools()` strips anything not
 *      in `EXCALIDRAW_ALLOWED_TOOLS`, including unknown tools that may appear
 *      after an upstream version bump but before this module is updated.
 *   3. Descriptions are NOT embedded here — they come from the live MCP
 *      `tools/list` response at runtime. This module only owns the *policy*
 *      decision (allow / block / approve), not the protocol surface.
 */
import type { MCPTool } from '@janhq/core'

// ---------------------------------------------------------------------------
// Blocked tools (2)
// ---------------------------------------------------------------------------

/**
 * Tools we deliberately do NOT surface to the LLM.
 *
 * Both blocked tools require the upstream Express-backed frontend server
 * (`mcp_excalidraw/src/server.ts`) which Jan does not run — we use Excalidraw
 * directly inside the renderer instead. Invoking these would either fail
 * silently (no server reachable) or block waiting for a browser handoff.
 *
 * Per-tool rationale:
 *   - `export_to_image`        — needs the Express frontend to render the
 *                                 canvas in a headed browser before
 *                                 rasterising. Jan exports via the
 *                                 in-process `Excalidraw` instance instead.
 *   - `get_canvas_screenshot`  — same requirement: needs the frontend open
 *                                 in a browser to take a screenshot. Jan's
 *                                 renderer-side screenshot path replaces it.
 */
export const EXCALIDRAW_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'export_to_image',
  'get_canvas_screenshot',
])

// ---------------------------------------------------------------------------
// Mutating tools (19) — require T21 user approval
// ---------------------------------------------------------------------------

/**
 * Tools whose invocation mutates user-visible canvas state, persists data on
 * the mcp_excalidraw side, writes to the filesystem, or pushes data to a
 * remote service. These MUST be gated behind T21's approval prompt.
 *
 * Conservative policy: when in doubt, classify as mutating. The cost of a
 * superfluous approval prompt is low; the cost of an unapproved mutation is
 * high (user can lose work, leak data, or hit unexpected network egress).
 */
export const EXCALIDRAW_MUTATING_TOOLS: ReadonlySet<string> = new Set([
  // ── Element CRUD ────────────────────────────────────────────────────────
  'create_element', // creates a new element on the canvas
  'update_element', // modifies an existing element
  'delete_element', // removes an element
  'batch_create_elements', // creates many elements in one call
  'duplicate_elements', // creates copies of elements with offset

  // ── Bulk / scene-level mutation ─────────────────────────────────────────
  'clear_canvas', // wipes all elements (destructive)
  'import_scene', // replaces canvas with imported JSON
  'create_from_mermaid', // creates elements from a mermaid spec

  // ── Layout transforms (move existing elements) ──────────────────────────
  'align_elements', // moves elements to align them
  'distribute_elements', // moves elements to distribute spacing
  'group_elements', // changes group membership of elements
  'ungroup_elements', // changes group membership of elements
  'lock_elements', // toggles the locked flag (mutates element state)
  'unlock_elements', // toggles the locked flag (mutates element state)

  // ── Persistence / side-effects ──────────────────────────────────────────
  'export_scene', // optionally WRITES TO A FILE — filesystem side effect
  'snapshot_scene', // writes a named snapshot to mcp_excalidraw's store
  'restore_snapshot', // replaces canvas state with a saved snapshot
  'export_to_excalidraw_url', // UPLOADS to excalidraw.com (network egress)

  // ── Viewport mutation (UI state, but visually disruptive) ───────────────
  'set_viewport', // moves the camera — user may not expect AI to do this
])

// ---------------------------------------------------------------------------
// Read-only tools (5) — auto-approved (no side effects)
// ---------------------------------------------------------------------------

/**
 * Pure query tools. Do not mutate canvas state, do not touch the filesystem,
 * do not make outbound network calls. Safe to auto-approve.
 *
 * Note: `read_diagram_guide` is a static documentation fetch baked into the
 * mcp_excalidraw binary — it returns the same string every call regardless
 * of canvas state, so it's the most trivially-read-only of the set.
 */
export const EXCALIDRAW_READONLY_TOOLS: ReadonlySet<string> = new Set([
  'query_elements', // filtered element list
  'get_element', // single element by id
  'get_resource', // read a server-side resource
  'describe_scene', // AI-readable canvas description
  'read_diagram_guide', // static design-guide text
])

// ---------------------------------------------------------------------------
// Composite allow-list (24)
// ---------------------------------------------------------------------------

/**
 * The full set of tools Jan surfaces to the LLM.
 *
 *   |allowed|  = |mutating| + |readonly|
 *              =      19    +     5
 *              =     24
 *
 *   |allowed| + |blocked| = 24 + 2 = 26  (matches canonical tools/list count)
 *
 * Invariants enforced by `curated-tools.test.ts`:
 *   - mutating ⊂ allowed
 *   - readonly ⊂ allowed
 *   - mutating ∩ readonly = ∅
 *   - allowed ∩ blocked = ∅
 *   - (allowed ∪ blocked) = the canonical 26-name source list
 */
export const EXCALIDRAW_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...EXCALIDRAW_MUTATING_TOOLS,
  ...EXCALIDRAW_READONLY_TOOLS,
])

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Strip any tool not in the closed allow-list.
 *
 * Semantics:
 *   - Closed allow-list: a tool is kept iff its `name` is in
 *     `EXCALIDRAW_ALLOWED_TOOLS`. Anything else — including blocked tools
 *     AND unknown future tools added by an upstream version bump but not yet
 *     classified here — is removed.
 *   - Pure: does not mutate the input array. Returns a new array with the
 *     same `MCPTool` object references (no deep-clone of tool objects).
 *   - Order-preserving: kept tools appear in the same order as in the input.
 *
 * @param tools - The raw `tools/list` payload from mcp_excalidraw.
 * @returns A new array containing only the curated, allowed tools.
 */
export function filterAllowedTools(tools: MCPTool[]): MCPTool[] {
  return tools.filter((tool) => EXCALIDRAW_ALLOWED_TOOLS.has(tool.name))
}

/**
 * Whether invoking `toolName` requires a T21 user-approval prompt.
 *
 * Returns `true` iff `toolName` is in `EXCALIDRAW_MUTATING_TOOLS`.
 *
 * Returns `false` for:
 *   - any tool in `EXCALIDRAW_READONLY_TOOLS` (auto-approve);
 *   - any unknown tool name. In practice this branch is unreachable because
 *     unknown names should already have been removed by `filterAllowedTools`
 *     at the orchestrator boundary; the conservative `false` here means the
 *     fail-closed defence lives in the filter, not in the approval gate.
 *
 * @param toolName - The MCP tool name (e.g. `'create_element'`).
 */
export function requiresApproval(toolName: string): boolean {
  return EXCALIDRAW_MUTATING_TOOLS.has(toolName)
}

// ---------------------------------------------------------------------------
// AI SDK tool definitions (for useCanvasChat)
// ---------------------------------------------------------------------------

import { jsonSchema, type Tool } from 'ai'

/**
 * Returns an AI SDK `Record<string, Tool>` for all tools in
 * `EXCALIDRAW_ALLOWED_TOOLS`.
 *
 * Descriptions and input schemas are intentionally minimal stubs — the real
 * shapes come from the live mcp_excalidraw `tools/list` response at runtime
 * (see `filterAllowedTools`). These stubs satisfy the Vercel AI SDK's
 * requirement that every tool in the `tools` map has at least an
 * `inputSchema` so the LLM can reference them in its system prompt.
 *
 * The hook (useCanvasChat) passes this record to `useChat` so the AI SDK
 * includes the tool names in the request context. Actual execution is
 * delegated to the CanvasMcpOrchestrator via `onToolCall`.
 *
 * Design: derives exclusively from `EXCALIDRAW_ALLOWED_TOOLS` — no separate
 * hardcoded list. If the allow-list changes, this function picks it up
 * automatically.
 */
export function getExcalidrawCuratedToolDefinitions(): Record<string, Tool> {
  const result: Record<string, Tool> = {}
  for (const name of EXCALIDRAW_ALLOWED_TOOLS) {
    result[name] = {
      description: `mcp_excalidraw tool: ${name}`,
      // Permissive object schema — the real schema is enforced by
      // mcp_excalidraw at call time via the MCP wire protocol.
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: 'object',
        additionalProperties: true,
      }),
    }
  }
  return result
}
