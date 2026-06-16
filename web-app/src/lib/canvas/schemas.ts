/**
 * Zod schemas for canvas AI tool calls.
 *
 * These schemas validate inputs and outputs for the five canvas tools
 * (`canvas.list`, `canvas.create`, `canvas.read`, `canvas.update`,
 * `canvas.delete`) at runtime. The static counterpart types live in
 * `web-app/src/types/canvas.ts` (T06); the inferred `z.infer` types here
 * intentionally mirror those shapes but are derived independently so the
 * AI SDK can introspect parameter docs from `.describe(...)` calls.
 *
 * Excalidraw element/appState/files objects are accepted as opaque shapes
 * (`z.unknown()` / `z.record(z.string(), z.unknown())`) so we never couple
 * to Excalidraw's internal schema — they evolve faster than we can track.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/**
 * Excalidraw scene snapshot. Validates only the outer container; the
 * elements array and appState/files records are accepted as opaque values.
 */
export const canvasSceneSchema = z
  .object({
    elements: z
      .array(z.unknown())
      .describe('Ordered list of Excalidraw elements that make up the scene.'),
    appState: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Optional Excalidraw app state (zoom, view background color, etc.). Opaque shape.'
      ),
    files: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Optional map of binary file payloads keyed by file id. Opaque shape.'
      ),
  })
  .describe('Excalidraw scene snapshot consisting of elements, appState, and files.')

/**
 * Lightweight metadata describing a canvas without its scene contents.
 * Used by the list endpoint and sidebar.
 */
export const canvasMetaSchema = z
  .object({
    id: z.uuid().describe('Unique canvas identifier (UUID v4).'),
    name: z.string().min(1).max(120).describe('Human-readable canvas name.'),
    createdAt: z
      .iso.datetime({ offset: true })
      .describe('ISO-8601 timestamp when the canvas was created.'),
    updatedAt: z
      .iso.datetime({ offset: true })
      .describe('ISO-8601 timestamp of the most recent update.'),
  })
  .describe('Canvas metadata without scene contents.')

/**
 * Full canvas record: metadata plus the embedded Excalidraw scene.
 */
export const canvasSchema = canvasMetaSchema
  .extend({
    scene: canvasSceneSchema.describe('Embedded Excalidraw scene for this canvas.'),
  })
  .describe('Complete canvas record including metadata and scene.')

// ---------------------------------------------------------------------------
// canvas.list
// ---------------------------------------------------------------------------

export const canvasListInputSchema = z
  .object({})
  .describe('canvas.list takes no parameters; lists every canvas in the workspace.')

export const canvasListOutputSchema = z
  .object({
    canvases: z
      .array(canvasMetaSchema)
      .describe('All canvases known to the workspace, ordered by the store.'),
  })
  .describe('Result of canvas.list: an array of canvas metadata.')

// ---------------------------------------------------------------------------
// canvas.create
// ---------------------------------------------------------------------------

export const canvasCreateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(120)
      .describe('Human-readable name for the new canvas (1–120 chars).'),
    scene: canvasSceneSchema
      .optional()
      .describe(
        'Optional initial Excalidraw scene. When omitted the canvas is created empty.'
      ),
  })
  .describe('Parameters for canvas.create.')

export const canvasCreateOutputSchema = z
  .object({
    id: z.uuid().describe('UUID of the newly created canvas.'),
    name: z.string().describe('Final stored name of the canvas.'),
    createdAt: z
      .iso.datetime({ offset: true })
      .describe('ISO-8601 timestamp at which the canvas was created.'),
  })
  .describe('Result of canvas.create.')

// ---------------------------------------------------------------------------
// canvas.read
// ---------------------------------------------------------------------------

export const canvasReadInputSchema = z
  .object({
    id: z.uuid().describe('UUID of the canvas to read.'),
  })
  .describe('Parameters for canvas.read.')

export const canvasReadOutputSchema = canvasSchema.describe(
  'Result of canvas.read: the full canvas record including scene.'
)

// ---------------------------------------------------------------------------
// canvas.update
// ---------------------------------------------------------------------------

export const canvasUpdateInputSchema = z
  .object({
    id: z.uuid().describe('UUID of the canvas to update.'),
    name: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe('New name for the canvas. Omit to leave unchanged.'),
    scene: canvasSceneSchema
      .optional()
      .describe('New scene contents. Omit to leave the scene unchanged.'),
  })
  .refine((d) => d.name !== undefined || d.scene !== undefined, {
    message: 'At least one of name or scene must be provided',
  })
  .describe(
    'Parameters for canvas.update. At least one of name or scene must be supplied.'
  )

export const canvasUpdateOutputSchema = z
  .object({
    id: z.uuid().describe('UUID of the canvas that was updated.'),
    updatedAt: z
      .iso.datetime({ offset: true })
      .describe('ISO-8601 timestamp of the update that was just applied.'),
  })
  .describe('Result of canvas.update.')

// ---------------------------------------------------------------------------
// canvas.delete
// ---------------------------------------------------------------------------

export const canvasDeleteInputSchema = z
  .object({
    id: z.uuid().describe('UUID of the canvas to delete.'),
  })
  .describe('Parameters for canvas.delete. Deletion is hard (no soft-delete).')

export const canvasDeleteOutputSchema = z
  .object({
    id: z.uuid().describe('UUID of the canvas that was removed.'),
    deleted: z
      .literal(true)
      .describe('Always true on success; the field is present to make tool replies explicit.'),
  })
  .describe('Result of canvas.delete on success.')

// ---------------------------------------------------------------------------
// Inferred TypeScript types — keep in sync with `web-app/src/types/canvas.ts`.
// ---------------------------------------------------------------------------

export type CanvasScene = z.infer<typeof canvasSceneSchema>
export type CanvasMeta = z.infer<typeof canvasMetaSchema>
export type Canvas = z.infer<typeof canvasSchema>

export type CanvasListInput = z.infer<typeof canvasListInputSchema>
export type CanvasListOutput = z.infer<typeof canvasListOutputSchema>

export type CanvasCreateInput = z.infer<typeof canvasCreateInputSchema>
export type CanvasCreateOutput = z.infer<typeof canvasCreateOutputSchema>

export type CanvasReadInput = z.infer<typeof canvasReadInputSchema>
export type CanvasReadOutput = z.infer<typeof canvasReadOutputSchema>

export type CanvasUpdateInput = z.infer<typeof canvasUpdateInputSchema>
export type CanvasUpdateOutput = z.infer<typeof canvasUpdateOutputSchema>

export type CanvasDeleteInput = z.infer<typeof canvasDeleteInputSchema>
export type CanvasDeleteOutput = z.infer<typeof canvasDeleteOutputSchema>
