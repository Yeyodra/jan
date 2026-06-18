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
 * Real tool schemas from mcp_excalidraw's tools/list response.
 * Embedded at build time from the vendored mcp_excalidraw server (SHA c12ff87).
 * These give the LLM actual parameter descriptions and input schemas.
 */
const EXCALIDRAW_TOOL_SCHEMAS: Record<string, { description: string; inputSchema: object }> = {
  create_element: {
    description: "Create a new Excalidraw element. For arrows, use startElementId/endElementId to bind to shapes (auto-routes to edges).",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "Custom element ID (optional, auto-generated if omitted). Use with startElementId/endElementId in batch_create_elements."
        },
        "type": {
          "type": "string",
          "enum": [
            "rectangle",
            "ellipse",
            "diamond",
            "arrow",
            "text",
            "freedraw",
            "line",
            "image"
          ]
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "width": {
          "type": "number"
        },
        "height": {
          "type": "number"
        },
        "backgroundColor": {
          "type": "string"
        },
        "strokeColor": {
          "type": "string"
        },
        "strokeWidth": {
          "type": "number"
        },
        "strokeStyle": {
          "type": "string",
          "description": "Stroke style: solid, dashed, dotted"
        },
        "roughness": {
          "type": "number"
        },
        "opacity": {
          "type": "number"
        },
        "text": {
          "type": "string"
        },
        "fontSize": {
          "type": "number"
        },
        "fontFamily": {
          "type": [
            "string",
            "number"
          ],
          "description": "Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID"
        },
        "startElementId": {
          "type": "string",
          "description": "For arrows: ID of the element to bind the arrow start to. Arrow auto-routes to element edge."
        },
        "endElementId": {
          "type": "string",
          "description": "For arrows: ID of the element to bind the arrow end to. Arrow auto-routes to element edge."
        },
        "endArrowhead": {
          "type": "string",
          "description": "Arrowhead style at end: arrow, bar, dot, triangle, or null"
        },
        "startArrowhead": {
          "type": "string",
          "description": "Arrowhead style at start: arrow, bar, dot, triangle, or null"
        }
      },
      "required": [
        "type",
        "x",
        "y"
      ]
    },
  },
  update_element: {
    description: "Update an existing Excalidraw element",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "type": "string",
          "enum": [
            "rectangle",
            "ellipse",
            "diamond",
            "arrow",
            "text",
            "freedraw",
            "line",
            "image"
          ]
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "width": {
          "type": "number"
        },
        "height": {
          "type": "number"
        },
        "backgroundColor": {
          "type": "string"
        },
        "strokeColor": {
          "type": "string"
        },
        "strokeWidth": {
          "type": "number"
        },
        "strokeStyle": {
          "type": "string"
        },
        "roughness": {
          "type": "number"
        },
        "opacity": {
          "type": "number"
        },
        "text": {
          "type": "string"
        },
        "fontSize": {
          "type": "number"
        },
        "fontFamily": {
          "type": [
            "string",
            "number"
          ],
          "description": "Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID"
        }
      },
      "required": [
        "id"
      ]
    },
  },
  delete_element: {
    description: "Delete an Excalidraw element",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    },
  },
  query_elements: {
    description: "Query Excalidraw elements with optional filters",
    inputSchema: {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "rectangle",
            "ellipse",
            "diamond",
            "arrow",
            "text",
            "freedraw",
            "line",
            "image"
          ]
        },
        "filter": {
          "type": "object",
          "additionalProperties": true
        },
        "bbox": {
          "type": "object",
          "description": "Bounding box filter ΓÇö only return elements whose origin (x, y) falls within the given coordinate range",
          "properties": {
            "x_min": {
              "type": "number"
            },
            "x_max": {
              "type": "number"
            },
            "y_min": {
              "type": "number"
            },
            "y_max": {
              "type": "number"
            }
          }
        }
      }
    },
  },
  get_resource: {
    description: "Get an Excalidraw resource",
    inputSchema: {
      "type": "object",
      "properties": {
        "resource": {
          "type": "string",
          "enum": [
            "scene",
            "library",
            "theme",
            "elements"
          ]
        }
      },
      "required": [
        "resource"
      ]
    },
  },
  group_elements: {
    description: "Group multiple elements together",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "elementIds"
      ]
    },
  },
  ungroup_elements: {
    description: "Ungroup a group of elements",
    inputSchema: {
      "type": "object",
      "properties": {
        "groupId": {
          "type": "string"
        }
      },
      "required": [
        "groupId"
      ]
    },
  },
  align_elements: {
    description: "Align elements to a specific position",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "alignment": {
          "type": "string",
          "enum": [
            "left",
            "center",
            "right",
            "top",
            "middle",
            "bottom"
          ]
        }
      },
      "required": [
        "elementIds",
        "alignment"
      ]
    },
  },
  distribute_elements: {
    description: "Distribute elements evenly",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "direction": {
          "type": "string",
          "enum": [
            "horizontal",
            "vertical"
          ]
        }
      },
      "required": [
        "elementIds",
        "direction"
      ]
    },
  },
  lock_elements: {
    description: "Lock elements to prevent modification",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "elementIds"
      ]
    },
  },
  unlock_elements: {
    description: "Unlock elements to allow modification",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "elementIds"
      ]
    },
  },
  create_from_mermaid: {
    description: "Convert a Mermaid diagram to Excalidraw elements and render them on the canvas",
    inputSchema: {
      "type": "object",
      "properties": {
        "mermaidDiagram": {
          "type": "string",
          "description": "The Mermaid diagram definition (e.g., \"graph TD; A-->B; B-->C;\")"
        },
        "config": {
          "type": "object",
          "description": "Optional Mermaid configuration",
          "properties": {
            "startOnLoad": {
              "type": "boolean"
            },
            "flowchart": {
              "type": "object",
              "properties": {
                "curve": {
                  "type": "string",
                  "enum": [
                    "linear",
                    "basis"
                  ]
                }
              }
            },
            "themeVariables": {
              "type": "object",
              "properties": {
                "fontSize": {
                  "type": "string"
                }
              }
            },
            "maxEdges": {
              "type": "number"
            },
            "maxTextSize": {
              "type": "number"
            }
          }
        }
      },
      "required": [
        "mermaidDiagram"
      ]
    },
  },
  batch_create_elements: {
    description: "Create multiple Excalidraw elements at once. For arrows, use startElementId/endElementId to bind arrows to shapes ΓÇö Excalidraw auto-routes to element edges. Assign custom id to shapes so arrows can reference them.",
    inputSchema: {
      "type": "object",
      "properties": {
        "elements": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "description": "Custom element ID. Arrows can reference this via startElementId/endElementId."
              },
              "type": {
                "type": "string",
                "enum": [
                  "rectangle",
                  "ellipse",
                  "diamond",
                  "arrow",
                  "text",
                  "freedraw",
                  "line",
                  "image"
                ]
              },
              "x": {
                "type": "number"
              },
              "y": {
                "type": "number"
              },
              "width": {
                "type": "number"
              },
              "height": {
                "type": "number"
              },
              "backgroundColor": {
                "type": "string"
              },
              "strokeColor": {
                "type": "string"
              },
              "strokeWidth": {
                "type": "number"
              },
              "strokeStyle": {
                "type": "string",
                "description": "Stroke style: solid, dashed, dotted"
              },
              "roughness": {
                "type": "number"
              },
              "opacity": {
                "type": "number"
              },
              "text": {
                "type": "string"
              },
              "fontSize": {
                "type": "number"
              },
              "fontFamily": {
                "type": [
                  "string",
                  "number"
                ],
                "description": "Font family: virgil/hand/handwritten (1), helvetica/sans/sans-serif (2), cascadia/mono/monospace (3), excalifont (5), nunito (6), lilita/lilita one (7), comic shanns/comic (8), or numeric ID"
              },
              "startElementId": {
                "type": "string",
                "description": "For arrows: ID of element to bind arrow start to"
              },
              "endElementId": {
                "type": "string",
                "description": "For arrows: ID of element to bind arrow end to"
              },
              "endArrowhead": {
                "type": "string",
                "description": "Arrowhead style at end: arrow, bar, dot, triangle, or null"
              },
              "startArrowhead": {
                "type": "string",
                "description": "Arrowhead style at start: arrow, bar, dot, triangle, or null"
              }
            },
            "required": [
              "type",
              "x",
              "y"
            ]
          }
        }
      },
      "required": [
        "elements"
      ]
    },
  },
  get_element: {
    description: "Get a single Excalidraw element by ID",
    inputSchema: {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "The element ID"
        }
      },
      "required": [
        "id"
      ]
    },
  },
  clear_canvas: {
    description: "Clear all elements from the canvas",
    inputSchema: {
      "type": "object",
      "properties": {}
    },
  },
  export_scene: {
    description: "Export the current canvas to .excalidraw JSON format. Optionally write to a file.",
    inputSchema: {
      "type": "object",
      "properties": {
        "filePath": {
          "type": "string",
          "description": "Optional file path to write the .excalidraw JSON file"
        }
      }
    },
  },
  import_scene: {
    description: "Import elements from a .excalidraw JSON file or raw JSON data",
    inputSchema: {
      "type": "object",
      "properties": {
        "filePath": {
          "type": "string",
          "description": "Path to a .excalidraw JSON file"
        },
        "data": {
          "type": "string",
          "description": "Raw .excalidraw JSON string (alternative to filePath)"
        },
        "mode": {
          "type": "string",
          "enum": [
            "replace",
            "merge"
          ],
          "description": "\"replace\" clears canvas first, \"merge\" appends to existing elements"
        }
      },
      "required": [
        "mode"
      ]
    },
  },
  export_to_image: {
    description: "Export the current canvas to PNG or SVG image. Requires the canvas frontend to be open in a browser.",
    inputSchema: {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "png",
            "svg"
          ],
          "description": "Image format"
        },
        "filePath": {
          "type": "string",
          "description": "Optional file path to save the image"
        },
        "background": {
          "type": "boolean",
          "description": "Include background in export (default: true)"
        }
      },
      "required": [
        "format"
      ]
    },
  },
  duplicate_elements: {
    description: "Duplicate elements with a configurable offset",
    inputSchema: {
      "type": "object",
      "properties": {
        "elementIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "IDs of elements to duplicate"
        },
        "offsetX": {
          "type": "number",
          "description": "Horizontal offset (default: 20)"
        },
        "offsetY": {
          "type": "number",
          "description": "Vertical offset (default: 20)"
        }
      },
      "required": [
        "elementIds"
      ]
    },
  },
  snapshot_scene: {
    description: "Save a named snapshot of the current canvas state for later restoration",
    inputSchema: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Name for this snapshot"
        }
      },
      "required": [
        "name"
      ]
    },
  },
  restore_snapshot: {
    description: "Restore the canvas from a previously saved named snapshot",
    inputSchema: {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Name of the snapshot to restore"
        }
      },
      "required": [
        "name"
      ]
    },
  },
  describe_scene: {
    description: "Get an AI-readable description of the current canvas: element types, positions, connections, labels, spatial layout, and bounding box. Use this to understand what is on the canvas before making changes.",
    inputSchema: {
      "type": "object",
      "properties": {}
    },
  },
  get_canvas_screenshot: {
    description: "Take a screenshot of the current canvas and return it as an image. Requires the canvas frontend to be open in a browser. Use this to visually verify what the diagram looks like.",
    inputSchema: {
      "type": "object",
      "properties": {
        "background": {
          "type": "boolean",
          "description": "Include background in screenshot (default: true)"
        }
      }
    },
  },
  read_diagram_guide: {
    description: "Returns a comprehensive design guide for creating beautiful Excalidraw diagrams: color palette, sizing rules, layout patterns, arrow binding best practices, diagram templates, and anti-patterns. Call this before creating diagrams to produce professional results.",
    inputSchema: {
      "type": "object",
      "properties": {}
    },
  },
  export_to_excalidraw_url: {
    description: "Export the current canvas to a shareable excalidraw.com URL. The diagram is encrypted and uploaded; anyone with the URL can view it. Returns the shareable link.",
    inputSchema: {
      "type": "object",
      "properties": {}
    },
  },
  set_viewport: {
    description: "Control the canvas viewport (camera). Auto-fit all elements, center on a specific element, or set zoom/scroll directly. Requires the canvas frontend open in a browser.",
    inputSchema: {
      "type": "object",
      "properties": {
        "scrollToContent": {
          "type": "boolean",
          "description": "Auto-fit all elements in view (zoom-to-fit)"
        },
        "scrollToElementId": {
          "type": "string",
          "description": "Center the view on a specific element by ID"
        },
        "zoom": {
          "type": "number",
          "description": "Zoom level (0.1ΓÇô10, where 1 = 100%)"
        },
        "offsetX": {
          "type": "number",
          "description": "Horizontal scroll offset"
        },
        "offsetY": {
          "type": "number",
          "description": "Vertical scroll offset"
        }
      }
    },
  },
}

/**
 * Returns an AI SDK `Record<string, Tool>` for all tools in
 * `EXCALIDRAW_ALLOWED_TOOLS` using the real schemas from mcp_excalidraw's
 * `tools/list` response (embedded in `EXCALIDRAW_TOOL_SCHEMAS` above).
 *
 * Tools in `EXCALIDRAW_BLOCKED_TOOLS` are excluded via the allow-list filter.
 * If a name is in `EXCALIDRAW_ALLOWED_TOOLS` but somehow missing from
 * `EXCALIDRAW_TOOL_SCHEMAS` (shouldn't happen), it is silently skipped.
 */
export function getExcalidrawCuratedToolDefinitions(): Record<string, Tool> {
  const result: Record<string, Tool> = {}
  for (const name of EXCALIDRAW_ALLOWED_TOOLS) {
    const schema = EXCALIDRAW_TOOL_SCHEMAS[name]
    if (!schema) continue
    result[name] = {
      description: schema.description,
      inputSchema: jsonSchema(schema.inputSchema),
    }
  }
  return result
}
