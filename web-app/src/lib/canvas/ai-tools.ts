/**
 * Canvas built-in AI tools (T18).
 *
 * Five LLM-callable tools that bridge model tool calls into the canvas store
 * (`web-app/src/stores/canvas-store.ts`, T05). Each tool is shaped to match the
 * MCP tool surface (`MCPTool` from `@janhq/core`) so that T20 can register
 * them through the same orchestrator path used for remote MCP tools — zero new
 * UX surface, single approval pipeline (T21).
 *
 * Tools (names use the snake_case convention LLMs are trained on):
 *   - canvas_list   – read-only, lists every canvas (id, name, timestamps,
 *                     elementCount). Truncated to the 50 most recently
 *                     updated to keep token usage bounded.
 *   - canvas_create – MUTATING, creates a new canvas with optional initial
 *                     scene. Returns {id, name, createdAt}.
 *   - canvas_read   – read-only, returns the full canvas record (metadata +
 *                     scene). `files` (binary embeds) are intentionally
 *                     stripped to keep the LLM context bounded.
 *   - canvas_update – MUTATING, applies a name/scene patch. Schema requires
 *                     at least one of name/scene; we re-validate at the
 *                     execute boundary to be defensive.
 *   - canvas_delete – MUTATING, hard-deletes a canvas.
 *
 * Approval gating
 * ---------------
 * The mutating tools (`canvas_create`, `canvas_update`, `canvas_delete`) MUST
 * be gated behind a user-approval prompt. This module is intentionally a pure
 * data layer — it returns the tool definitions and exposes
 * `mutatingToolNames` so the registration layer (T20) and approval UX (T21)
 * can identify which calls require explicit consent before execution.
 *
 * Validation
 * ----------
 * Each `handler` validates its input via the matching zod schema (T07) and
 * its output via the corresponding `*OutputSchema` before returning. If the
 * store ever drifts from the schema we catch it at the boundary instead of
 * shipping a malformed reply back to the model.
 *
 * Description strings
 * -------------------
 * Tool descriptions are English literals because LLM tool selection works
 * best in English regardless of UI locale. The matching i18n keys
 * (`aiTools.canvasList.description` etc. in `web-app/src/locales/en/canvas.json`)
 * are cited next to each definition so the approval UX (T21) can render the
 * user-facing copy in the active locale without duplicating strings.
 *
 * NOTE: This module deliberately does NOT register the tools globally — that
 * is T20's responsibility (canvas tool source registration in MCP/AppState).
 * It also does NOT show toasts, navigate, or call any UI APIs.
 */
import { z } from 'zod'

import { useCanvasStore } from '@/stores/canvas-store'

import {
  canvasCreateInputSchema,
  canvasCreateOutputSchema,
  canvasDeleteInputSchema,
  canvasDeleteOutputSchema,
  canvasListInputSchema,
  canvasListOutputSchema,
  canvasReadInputSchema,
  canvasReadOutputSchema,
  canvasUpdateInputSchema,
  canvasUpdateOutputSchema,
} from './schemas'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Synthetic server name reported on each `MCPTool` so the orchestrator can
 * route calls back to this in-process tool source. T20 wires the actual
 * dispatch; this constant just makes the source identifiable end-to-end.
 */
export const CANVAS_TOOL_SERVER = 'canvas' as const

/**
 * Maximum number of canvases returned by `canvas_list`. The list view renders
 * everything, but the LLM only ever needs the most recently touched ones —
 * capping at 50 keeps the model's context bounded even in workspaces with
 * thousands of canvases.
 */
export const CANVAS_LIST_LIMIT = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Built-in tool shape: a `MCPTool` plus an in-process `handler`. We mirror
 * `MCPTool` structurally rather than extending it directly because the
 * `inputSchema` we publish here is hand-written JSON Schema (no
 * `zod-to-json-schema` dep in this repo) and we want the type to make that
 * explicit.
 */
export type CanvasBuiltinTool = {
  /** Tool name surfaced to the LLM, e.g. `canvas_list`. */
  name: string
  /** LLM-facing description (English literal — see module comment). */
  description: string
  /** JSON Schema describing the tool's parameters. Object schemas only. */
  inputSchema: Record<string, unknown>
  /** Synthetic server name; always {@link CANVAS_TOOL_SERVER} for our tools. */
  server: typeof CANVAS_TOOL_SERVER
  /**
   * In-process handler. Receives a *raw* args object (already JSON-parsed),
   * re-validates it via the bound zod schema, calls into the canvas store,
   * validates the response against the matching output schema, and returns
   * the result. Any thrown `Error` is surfaced back to the LLM by the
   * orchestrator as a tool error.
   */
  handler: (args: unknown) => Promise<unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a zod `ZodError` into a single human-readable string. The AI SDK
 * stringifies thrown `Error.message` into the model's tool-error reply, so
 * keeping this concise but informative helps the model self-correct.
 */
const formatZodError = (err: z.ZodError): string => {
  return err.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

/**
 * Wraps a handler body so that:
 *   1. Zod validation errors are reformatted into a clean message.
 *   2. Any other thrown error (e.g. from the store) is sanitized into a
 *      `Canvas operation failed: ...` so the model never sees raw stack
 *      traces or implementation details.
 *
 * Errors that already start with `Canvas ` (such as
 * `Canvas not found: <id>`) are passed through unchanged because they are
 * already model-friendly.
 */
const runHandler = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(`${label} failed: ${formatZodError(err)}`)
    }
    if (err instanceof Error) {
      // Already-friendly errors (e.g. "Canvas not found: ...") pass through.
      if (err.message.startsWith('Canvas ')) {
        throw err
      }
      throw new Error(`Canvas operation failed: ${err.message}`)
    }
    throw new Error('Canvas operation failed: unknown error')
  }
}

// ---------------------------------------------------------------------------
// Hand-written JSON Schema for each tool input
// ---------------------------------------------------------------------------
//
// `zod-to-json-schema` is not a dependency of this workspace, so we hand-roll
// the JSON Schema descriptors that the model actually receives. They mirror
// the shapes in `./schemas.ts` (T07) — keep them in sync if the zod schemas
// change. Hand-writing also lets us keep the descriptions tightly tuned for
// LLM consumption (which is the only consumer of the JSON Schema here).
// ---------------------------------------------------------------------------

const sceneJsonSchema: Record<string, unknown> = {
  type: 'object',
  description:
    'Excalidraw scene snapshot consisting of elements, appState, and files.',
  properties: {
    elements: {
      type: 'array',
      description:
        'Ordered list of Excalidraw elements that make up the scene.',
      items: {},
    },
    appState: {
      type: 'object',
      description:
        'Optional Excalidraw app state (zoom, view background color, etc.). Opaque shape.',
      additionalProperties: true,
    },
    files: {
      type: 'object',
      description:
        'Optional map of binary file payloads keyed by file id. Opaque shape.',
      additionalProperties: true,
    },
  },
  required: ['elements'],
  additionalProperties: false,
}

const canvasListInputJsonSchema: Record<string, unknown> = {
  type: 'object',
  description:
    'canvas_list takes no parameters; lists every canvas in the workspace.',
  properties: {},
  additionalProperties: false,
}

const canvasCreateInputJsonSchema: Record<string, unknown> = {
  type: 'object',
  description: 'Parameters for canvas_create.',
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'Human-readable name for the new canvas (1–120 chars).',
    },
    scene: {
      ...sceneJsonSchema,
      description:
        'Optional initial Excalidraw scene. When omitted the canvas is created empty.',
    },
  },
  required: ['name'],
  additionalProperties: false,
}

const canvasReadInputJsonSchema: Record<string, unknown> = {
  type: 'object',
  description: 'Parameters for canvas_read.',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'UUID of the canvas to read.',
    },
  },
  required: ['id'],
  additionalProperties: false,
}

const canvasUpdateInputJsonSchema: Record<string, unknown> = {
  type: 'object',
  description:
    'Parameters for canvas_update. At least one of name or scene must be supplied.',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'UUID of the canvas to update.',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      description: 'New name for the canvas. Omit to leave unchanged.',
    },
    scene: {
      ...sceneJsonSchema,
      description: 'New scene contents. Omit to leave the scene unchanged.',
    },
  },
  required: ['id'],
  additionalProperties: false,
}

const canvasDeleteInputJsonSchema: Record<string, unknown> = {
  type: 'object',
  description:
    'Parameters for canvas_delete. Deletion is hard (no soft-delete).',
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: 'UUID of the canvas to delete.',
    },
  },
  required: ['id'],
  additionalProperties: false,
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * canvas_list — i18n: aiTools.canvasList.description
 *
 * Read-only. Returns the most recently updated canvases first, capped at
 * {@link CANVAS_LIST_LIMIT}. The LLM never needs scene contents here — that
 * is the job of `canvas_read`.
 */
const canvasListTool: CanvasBuiltinTool = {
  name: 'canvas_list',
  description:
    "Lists all canvases in your local library, returning each canvas's id, name, last-modified time, and element count. Read-only and does not modify any canvas.",
  inputSchema: canvasListInputJsonSchema,
  server: CANVAS_TOOL_SERVER,
  handler: async (args) =>
    runHandler('canvas_list', () => {
      // Validate input even though the schema is empty — defends against
      // future schema drift and keeps the boundary uniform.
      canvasListInputSchema.parse(args ?? {})

      const ordered = useCanvasStore
        .getState()
        .listOrderedByUpdated()
        .slice(0, CANVAS_LIST_LIMIT)

      const canvases = ordered.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }))

      return canvasListOutputSchema.parse({ canvases })
    }),
}

/**
 * canvas_create — i18n: aiTools.canvasCreate.description
 *
 * MUTATING. Gated behind user approval (see `mutatingToolNames`). Accepts an
 * optional initial scene which is forwarded to `useCanvasStore.create()`
 * verbatim — the store builds the rest of the record (id, timestamps).
 */
const canvasCreateTool: CanvasBuiltinTool = {
  name: 'canvas_create',
  description:
    'Creates a new canvas with the provided name and optional initial Excalidraw scene. Returns the new canvas id. Requires user approval before running.',
  inputSchema: canvasCreateInputJsonSchema,
  server: CANVAS_TOOL_SERVER,
  handler: async (args) =>
    runHandler('canvas_create', () => {
      const input = canvasCreateInputSchema.parse(args)

      // The schema already enforces min(1), but re-check explicitly so the
      // model gets a clear error rather than relying on the schema message
      // being good enough. (Belt-and-braces; cheap.)
      if (!input.name || input.name.trim().length === 0) {
        throw new Error('canvas_create failed: name must be a non-empty string')
      }

      const store = useCanvasStore.getState()
      // The store accepts an optional `scene` of type CanvasScene (T05).
      // The schema's CanvasScene shape is structurally compatible with the
      // store's accepted shape (elements?: any[], appState?: object,
      // files?: object), so we forward directly. We cast to the store's
      // `CanvasScene` view to bridge the differing element-type variance
      // without coupling either layer to Excalidraw's element types here.
      const id = store.create(
        input.name,
        input.scene as Parameters<typeof store.create>[1]
      )

      const created = store.get(id)
      if (!created) {
        // Defensive: would only happen if the store mutated under us between
        // create() and get() — keep the error model-friendly.
        throw new Error('Canvas operation failed: created canvas disappeared')
      }

      return canvasCreateOutputSchema.parse({
        id: created.id,
        name: created.name,
        createdAt: created.createdAt,
      })
    }),
}

/**
 * canvas_read — i18n: aiTools.canvasRead.description
 *
 * Read-only. Returns the full canvas record but with `files` (binary embeds)
 * stripped — those are too large for an LLM context window and are not
 * actionable for the model. The full scene (elements + appState) is
 * preserved so the model can reason about / modify content.
 */
const canvasReadTool: CanvasBuiltinTool = {
  name: 'canvas_read',
  description:
    'Reads the Excalidraw scene (elements and app state) of the canvas with the given id. Read-only.',
  inputSchema: canvasReadInputJsonSchema,
  server: CANVAS_TOOL_SERVER,
  handler: async (args) =>
    runHandler('canvas_read', () => {
      const { id } = canvasReadInputSchema.parse(args)

      const canvas = useCanvasStore.getState().get(id)
      if (!canvas) {
        throw new Error(`Canvas not found: ${id}`)
      }

      // Strip binary `files` to keep the model's context bounded — the schema
      // accepts `files` as optional, and a missing `files` key is preferable
      // to an empty object that the model might try to introspect.
      return canvasReadOutputSchema.parse({
        id: canvas.id,
        name: canvas.name,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
        scene: {
          elements: canvas.elements,
          appState: canvas.appState,
        },
      })
    }),
}

/**
 * canvas_update — i18n: aiTools.canvasUpdate.description
 *
 * MUTATING. Gated behind user approval. Applies a partial patch (name and/or
 * scene). The schema's `.refine` enforces "at least one of name|scene"; we
 * re-check explicitly here for clearer model-facing errors.
 */
const canvasUpdateTool: CanvasBuiltinTool = {
  name: 'canvas_update',
  description:
    "Updates the name and/or Excalidraw scene of an existing canvas. At least one of `name` or `scene` must be provided. Returns the canvas's new updatedAt timestamp. Requires user approval before running.",
  inputSchema: canvasUpdateInputJsonSchema,
  server: CANVAS_TOOL_SERVER,
  handler: async (args) =>
    runHandler('canvas_update', () => {
      const input = canvasUpdateInputSchema.parse(args)

      // Schema's .refine already guards this, but a defensive check makes
      // the failure mode obvious if the schema is ever loosened.
      if (input.name === undefined && input.scene === undefined) {
        throw new Error(
          'canvas_update failed: at least one of name or scene must be provided'
        )
      }

      const store = useCanvasStore.getState()
      const existing = store.get(input.id)
      if (!existing) {
        throw new Error(`Canvas not found: ${input.id}`)
      }

      // Build the partial patch the store expects (`Partial<Omit<Canvas,
      // 'id' | 'createdAt'>>`). We translate the schema's `scene` envelope
      // back into the store's flat shape (elements/appState/files at the
      // top level of `Canvas`).
      const partial: Parameters<typeof store.update>[1] = {}
      if (input.name !== undefined) {
        partial.name = input.name
      }
      if (input.scene !== undefined) {
        partial.elements =
          input.scene.elements as unknown as typeof existing.elements
        if (input.scene.appState !== undefined) {
          partial.appState =
            input.scene.appState as unknown as typeof existing.appState
        }
        if (input.scene.files !== undefined) {
          partial.files =
            input.scene.files as unknown as typeof existing.files
        }
      }
      store.update(input.id, partial)

      const updated = store.get(input.id)
      if (!updated) {
        throw new Error('Canvas operation failed: updated canvas disappeared')
      }

      return canvasUpdateOutputSchema.parse({
        id: updated.id,
        updatedAt: updated.updatedAt,
      })
    }),
}

/**
 * canvas_delete — i18n: aiTools.canvasDelete.description
 *
 * MUTATING. Gated behind user approval. Hard-deletes the canvas; there is no
 * soft-delete or undo (see decisions.md / T05).
 */
const canvasDeleteTool: CanvasBuiltinTool = {
  name: 'canvas_delete',
  description:
    'Permanently deletes the canvas with the given id from the local library. This action cannot be undone and requires user approval before running.',
  inputSchema: canvasDeleteInputJsonSchema,
  server: CANVAS_TOOL_SERVER,
  handler: async (args) =>
    runHandler('canvas_delete', () => {
      const { id } = canvasDeleteInputSchema.parse(args)

      const store = useCanvasStore.getState()
      if (!store.get(id)) {
        throw new Error(`Canvas not found: ${id}`)
      }
      store.delete(id)

      return canvasDeleteOutputSchema.parse({ id, deleted: true as const })
    }),
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Ordered list of all built-in canvas tools. T20 forwards this array straight
 * into the MCP tool source; T28 iterates it for round-trip tests.
 */
export const canvasBuiltinTools: readonly CanvasBuiltinTool[] = [
  canvasListTool,
  canvasCreateTool,
  canvasReadTool,
  canvasUpdateTool,
  canvasDeleteTool,
] as const

/**
 * Names of tools that mutate canvas state. T21 reads this set to decide
 * which tool calls require explicit user approval before execution. The
 * read-only tools (`canvas_list`, `canvas_read`) are intentionally absent.
 */
export const mutatingToolNames: ReadonlySet<string> = new Set([
  'canvas_create',
  'canvas_update',
  'canvas_delete',
])

/**
 * Convenience lookup: tool-name → tool definition. Built once at module load.
 * Useful for the orchestrator's `callTool({ toolName })` dispatch path so it
 * can avoid scanning the array on every invocation.
 */
export const canvasBuiltinToolsByName: ReadonlyMap<string, CanvasBuiltinTool> =
  new Map(canvasBuiltinTools.map((t) => [t.name, t]))
