/**
 * Canvas thumbnail generator — turns a live Excalidraw scene into a
 * compact data-URI suitable for `<img src="">` in the canvas list cards
 * (`CanvasCard`).
 *
 * Why SVG, not PNG:
 *   - Vector: stays crisp at any card size, no resolution-vs-bytes tradeoff.
 *   - Tiny: typical 4-shape scene serializes to ~2-6 KB. PNG-equivalent
 *     thumbnails would be 30-80 KB, ballooning the IndexedDB persist payload.
 *   - Side-steps the empty-PNG bug we hit on the in-house `exportToBlob`
 *     path: `exportToSvg` consumes a different appState slice and our
 *     `exportCanvasToSvg` helper already whitelists the safe fields.
 *   - No Canvas2D / `toBlob` round-trip → cheap to call from a debounced
 *     auto-save handler.
 *
 * Data shape:
 *   - Returns a `data:image/svg+xml;base64,<...>` string. Browsers (Chromium
 *     in Tauri's WebView2 + Wry) render this directly inside an `<img>` tag.
 *   - Empty scenes return `null` so the card falls back to the placeholder
 *     icon instead of rendering an "empty white square" thumbnail (the same
 *     symptom we explicitly removed from the Save-As path).
 *
 * Failure mode:
 *   - Any error during SVG export resolves to `null`. Auto-save then writes
 *     the canvas WITHOUT touching `thumbnail`, so the previous good
 *     thumbnail (if any) survives.
 */
import { exportCanvasToSvg } from '@/lib/canvas/exporters'
import type { CanvasScene } from '@/types/canvas'

export interface GenerateThumbnailOptions {
  /**
   * Whether to render the scene's background. Defaults to `true` because
   * cards look better with a solid fill that matches the user's chosen
   * canvas color. Set to `false` for transparent thumbnails (e.g. if the
   * card chrome already paints a background).
   */
  withBackground?: boolean
}

/**
 * Encode a UTF-8 string as base64 in a Tauri / Chromium WebView. We avoid
 * `btoa(unescape(encodeURIComponent(...)))` (deprecated) in favor of the
 * `TextEncoder` + `Uint8Array` round-trip, which handles non-ASCII text
 * inside SVG `<text>` elements correctly.
 */
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  // `btoa` only accepts binary strings, so fold the bytes into one. Building
  // the string in chunks keeps us under the V8 argument-count limit for
  // very large SVGs (`String.fromCharCode(...big)` throws past ~120k args).
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    )
  }
  return btoa(binary)
}

/**
 * Generate a list-card thumbnail for the given scene.
 *
 * @param scene  The live (or persisted) scene to render. Pass whatever
 *               `excalidrawAPI.getSceneElements / getAppState / getFiles`
 *               returned, or the same fields off a stored `Canvas` record.
 * @param opts   Optional rendering tweaks.
 * @returns      A `data:image/svg+xml;base64,<...>` URI on success, or
 *               `null` for empty scenes / serialization failures.
 */
export async function generateCanvasThumbnail(
  scene: CanvasScene,
  opts: GenerateThumbnailOptions = {},
): Promise<string | null> {
  // Empty scenes get no thumbnail. The CanvasCard falls back to the
  // placeholder icon, which is the right UX for a brand-new "Untitled
  // canvas" the user hasn't drawn anything on yet.
  const hasNonDeleted = scene.elements.some(
    (el) => !(el as { isDeleted?: boolean }).isDeleted,
  )
  if (!hasNonDeleted) return null

  try {
    const svgString = await exportCanvasToSvg(scene, {
      withBackground: opts.withBackground ?? true,
    })
    return `data:image/svg+xml;base64,${utf8ToBase64(svgString)}`
  } catch (err) {
    // Don't crash auto-save just because thumbnail generation hiccuped on
    // some pathological element shape. Log + return null; the caller is
    // expected to skip the `thumbnail` field on the store update so the
    // last-known-good thumbnail is preserved.
    // eslint-disable-next-line no-console
    console.warn('[canvas/thumbnail] failed to generate SVG thumbnail', err)
    return null
  }
}
