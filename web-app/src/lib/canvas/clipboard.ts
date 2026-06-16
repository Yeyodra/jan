/**
 * Canvas clipboard helper — copies a rendered canvas scene to the OS
 * clipboard as a PNG image.
 *
 * Design rules:
 *   - PURE. No toasts, no UI, no store / i18n access. The caller catches
 *     thrown errors and translates the embedded i18n key.
 *   - Web Clipboard API only. The Tauri webview permits `navigator.clipboard`
 *     by default; no `plugin-clipboard-manager` is needed for image data.
 *   - Support detection runs BEFORE the write attempt so callers can
 *     distinguish "browser/context can't do this" from "user denied / write
 *     failed".
 *
 * Errors thrown from {@link copyCanvasImageToClipboard} carry an i18n key
 * as their `message` (matching the keys defined by T02 locale):
 *   - `errors.clipboardUnsupported` — `navigator.clipboard` or
 *     `window.ClipboardItem` is missing (older browsers, insecure contexts).
 *   - `errors.clipboardFailed` — the underlying `clipboard.write` rejected
 *     (permission denied, transient OS failure). The original error is
 *     attached as `.cause`.
 */
import { exportCanvasToPng } from '@/lib/canvas/exporters'
import type { CanvasScene } from '@/types/canvas'

/**
 * Returns `true` only when the runtime can write image blobs to the
 * clipboard. Both `navigator.clipboard.write` and the global
 * `ClipboardItem` constructor are required — older browsers and insecure
 * (non-HTTPS, non-localhost) contexts expose neither.
 */
export function isClipboardImageSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof globalThis.ClipboardItem === 'function'
  )
}

/**
 * Render `scene` to PNG and write the resulting blob to the OS clipboard.
 *
 * @throws Error with `message = 'errors.clipboardUnsupported'` when the
 *   runtime lacks the Async Clipboard image API.
 * @throws Error with `message = 'errors.clipboardFailed'` when the write
 *   itself rejects; the original failure is attached as `.cause`.
 */
export async function copyCanvasImageToClipboard(
  scene: CanvasScene
): Promise<void> {
  if (!isClipboardImageSupported()) {
    throw new Error('errors.clipboardUnsupported')
  }

  // `exportCanvasToPng` defaults to a 2× pixel ratio and honors
  // `appState.viewBackgroundColor` via its `exportBackground` plumbing —
  // no extra options needed here.
  const blob = await exportCanvasToPng(scene)

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ])
  } catch (cause) {
    throw new Error('errors.clipboardFailed', { cause })
  }
}
