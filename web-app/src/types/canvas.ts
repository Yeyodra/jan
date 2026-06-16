/**
 * Canvas feature — single source of truth for shared TypeScript types.
 *
 * Consumers:
 *   - T05  store:        web-app/src/store/canvas.ts (Zustand state, persistence ops)
 *   - T08  editor:       web-app/src/containers/canvas/CanvasEditor.tsx (renders Excalidraw, hydrates scene)
 *   - T15  list view:    web-app/src/routes/canvas/index.tsx (uses CanvasMeta for tiles)
 *   - T17  detail route: web-app/src/routes/canvas/$canvasId.tsx (route loader resolves Canvas by id)
 *   - T18  AI tools:     web-app/src/services/ai/canvasTools.ts (tool argument shapes / scene mutations)
 *
 * Do NOT redeclare these shapes in those modules — import from here.
 *
 * Validation schemas (Zod) live in T07 (web-app/src/types/canvas.schema.ts) and MUST stay
 * structurally compatible with the types in this file. This file is types-only — no runtime code.
 */
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

/**
 * The renderable element list. Excalidraw's API returns deleted elements with `isDeleted: true`;
 * we keep the wider `ExcalidrawElement` type when reading from the API and narrow to
 * `NonDeletedExcalidrawElement` for code paths that have already filtered.
 */
export type CanvasElement = ExcalidrawElement
export type CanvasNonDeletedElement = NonDeletedExcalidrawElement

/**
 * The renderable scene — exactly the shape `excalidrawAPI.updateScene()` accepts.
 * AppState is intentionally `Partial<AppState>` because callers usually pass a subset
 * (viewBackgroundColor, gridSize, theme, etc.) rather than the full app state.
 */
export type CanvasScene = {
  elements: readonly CanvasElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

/**
 * Full record persisted to IndexedDB / disk.
 * `createdAt` and `updatedAt` are ISO 8601 strings (e.g. "2026-06-16T13:42:00.000Z")
 * for JSON-friendly storage and stable cross-environment ordering.
 */
export type Canvas = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  elements: readonly CanvasElement[]
  appState: Partial<AppState>
  files: BinaryFiles
  /** Base64-encoded PNG (data URL prefix included) used for list-view previews. */
  thumbnail?: string
}

/**
 * Lightweight projection used by the list view. Avoids loading full element/file payloads
 * when rendering the canvas grid.
 */
export type CanvasMeta = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  elementCount: number
  thumbnail?: string
}

/** Supported export formats from the canvas toolbar / AI export tool. */
export type CanvasExportFormat = 'png' | 'svg' | 'json'
