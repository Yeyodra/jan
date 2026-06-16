/**
 * Canvas exporters — pure functions that turn an Excalidraw scene into
 * downloadable artifacts (PNG, SVG, .excalidraw JSON).
 *
 * Design rules:
 *   - PURE. No toasts, no UI, no store access. Callers (route / hook) are
 *     responsible for surfacing errors and triggering downloads.
 *   - Wraps Excalidraw's own export utilities — never re-implements canvas
 *     rendering or SVG serialization.
 *   - PNG defaults to 2× pixel ratio for crisp output on hi-DPI displays;
 *     callers can override via `opts.scale`.
 *
 * Import paths (verified against `@excalidraw/excalidraw@0.18.1`):
 *   - `exportToBlob`, `exportToSvg` are re-exported from the package root
 *     (originally declared in `@excalidraw/utils/export`).
 *   - `serializeAsJSON` is re-exported from the package root (originally in
 *     `./data/json`). It expects a 4th argument: `"local" | "database"` —
 *     we pass `"local"` to match Excalidraw's "Save to disk" behavior.
 *
 * Consumers:
 *   - T16 clipboard wrapper (PNG via {@link exportCanvasToPng})
 *   - T17 Tauri filesystem save (any of the three blobs/strings)
 *   - T22 insert-to-chat (PNG via {@link exportCanvasToPng})
 *   - canvas detail toolbar (all three + {@link downloadBlob})
 */
import {
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawElement,
  NonDeleted,
} from '@excalidraw/excalidraw/element/types'
import type { AppState } from '@excalidraw/excalidraw/types'

import type { Canvas, CanvasScene } from '@/types/canvas'

/**
 * Options accepted by {@link exportCanvasToPng}.
 */
export type ExportPngOptions = {
  /**
   * Whether to render the canvas background (set to `false` for transparent
   * exports). Defaults to `true` to match Excalidraw's UI behavior.
   */
  withBackground?: boolean
  /**
   * Pixel ratio multiplier. Defaults to `2` so the resulting PNG is crisp on
   * hi-DPI displays without callers having to know about Excalidraw's
   * `getDimensions` hook.
   */
  scale?: number
}

/**
 * Options accepted by {@link exportCanvasToSvg}.
 */
export type ExportSvgOptions = {
  /**
   * Whether to render the canvas background. Defaults to `true`.
   */
  withBackground?: boolean
}

/**
 * Excalidraw's `exportToBlob` and `exportToSvg` declare their `elements`
 * parameter as `readonly NonDeleted<ExcalidrawElement>[]`. Our `CanvasScene`
 * carries the wider `ExcalidrawElement[]` (which may include deleted entries
 * with `isDeleted: true`). The export utilities filter deleted elements
 * internally, but TypeScript still needs the narrower type at the call site.
 *
 * This helper performs that narrowing without a runtime filter pass — the
 * downstream Excalidraw code is the source of truth for what counts as
 * "non-deleted".
 */
function asNonDeleted(
  elements: readonly ExcalidrawElement[]
): readonly NonDeleted<ExcalidrawElement>[] {
  return elements as readonly NonDeleted<ExcalidrawElement>[]
}

/**
 * Render a scene to a PNG `Blob`. Defaults to a 2× pixel ratio so the result
 * looks sharp when shown on hi-DPI displays or pasted into chat at native
 * dimensions.
 *
 * @throws Re-throws whatever Excalidraw throws (typically a DOMException when
 *         the underlying canvas can't allocate). Callers are expected to
 *         translate the error into a user-facing toast.
 */
export async function exportCanvasToPng(
  scene: CanvasScene,
  opts: ExportPngOptions = {}
): Promise<Blob> {
  const { withBackground = true, scale = 2 } = opts

  // `exportPadding` is a TOP-LEVEL parameter on `exportToBlob` (NOT an
  // `AppState` field — see `node_modules/@excalidraw/excalidraw/dist/types/utils/export.d.ts`).
  // The live appState we receive from `excalidrawAPI.getAppState()` may
  // carry an `exportPadding` value used by the in-app export dialog; pull
  // it out and forward it at the top level. Falling back to `10` matches
  // Excalidraw's own default (`Vi`) so the scene has breathing room
  // around the bounding box.
  const partial = scene.appState as Partial<AppState> & {
    exportPadding?: number
  }
  const exportPadding = partial.exportPadding ?? 10

  return exportToBlob({
    elements: asNonDeleted(scene.elements),
    appState: {
      ...partial,
      // `exportBackground` is the field Excalidraw reads when deciding
      // whether to fill the export with `viewBackgroundColor`.
      exportBackground: withBackground,
      // `exportScale` is the field Excalidraw's renderer reads to
      // multiply the output canvas resolution. Setting it here produces
      // a sharper image without needing a custom `getDimensions`
      // callback (which has a more delicate contract with the renderer).
      exportScale: scale,
    },
    files: scene.files,
    mimeType: 'image/png',
    exportPadding,
  })
}

/**
 * Render a scene to a serialized SVG string. The function delegates to
 * Excalidraw's `exportToSvg` (which returns an `SVGSVGElement`) and then
 * serializes the element with `XMLSerializer`.
 *
 * The result is suitable for writing directly to a `.svg` file or embedding
 * in HTML.
 *
 * @throws Re-throws whatever Excalidraw throws.
 */
export async function exportCanvasToSvg(
  scene: CanvasScene,
  opts: ExportSvgOptions = {}
): Promise<string> {
  const { withBackground = true } = opts

  // `exportToSvg`'s `appState` parameter is intentionally narrower than the
  // full Excalidraw `AppState` — it only reads a handful of fields. We pull
  // those (with safe fallbacks) from the caller-provided partial app state.
  // Note: `exportPadding` is a TOP-LEVEL parameter on `exportToSvg`, not an
  // `AppState` field — see `node_modules/@excalidraw/excalidraw/dist/types/utils/export.d.ts`.
  const partial = scene.appState as Partial<AppState> & {
    exportPadding?: number
  }
  const appState = {
    exportBackground: withBackground,
    exportScale: partial.exportScale,
    viewBackgroundColor: partial.viewBackgroundColor ?? '#ffffff',
    exportWithDarkMode: partial.exportWithDarkMode,
    exportEmbedScene: partial.exportEmbedScene,
    frameRendering: partial.frameRendering,
  }

  const svgElement = await exportToSvg({
    elements: asNonDeleted(scene.elements),
    appState,
    files: scene.files,
    exportPadding: partial.exportPadding,
  })

  return new XMLSerializer().serializeToString(svgElement)
}

/**
 * Serialize a {@link Canvas} record to the `.excalidraw` JSON file format.
 *
 * Returns the canonical Excalidraw export string (synchronously — there is no
 * I/O involved). Callers can write the returned string to a `.excalidraw`
 * file or embed it in a download anchor.
 *
 * The 4th argument to `serializeAsJSON` is `"local" | "database"`. We pass
 * `"local"` because the result is meant for on-disk export, not for
 * collaborative-server persistence (which would strip per-client fields).
 */
export function exportCanvasToJson(canvas: Canvas): string {
  return serializeAsJSON(
    canvas.elements,
    canvas.appState,
    canvas.files,
    'local'
  )
}

/**
 * Trigger a browser download for the given blob. Pure DOM glue — creates a
 * temporary object URL, simulates an anchor click, then revokes the URL on
 * the next event-loop tick to avoid leaking the underlying buffer.
 *
 * Browser-only. In a Tauri environment the renderer is still a Chromium
 * webview, so this works there too — but the route layer should prefer
 * Tauri's native save dialog (T17) when `IS_TAURI` is set so the user sees a
 * proper file picker.
 *
 * @param blob     The payload to download.
 * @param filename The filename suggested to the browser (e.g. `scene.png`).
 *                 The browser may sanitize or override this.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  // `rel=noopener` is harmless on a download anchor and prevents any
  // `window.opener` leak if a user agent treats the click as a navigation.
  anchor.rel = 'noopener'
  // The anchor must be in the DOM in some browsers (notably Firefox) for the
  // synthetic click to dispatch a download.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Defer revocation to the next tick — revoking synchronously can race the
  // browser's download pipeline on slow disks.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
