/**
 * Canvas — Tauri-backed file I/O for export/import.
 *
 * Two responsibilities:
 *   - {@link saveCanvasFile}: open the OS save dialog, write the picked path.
 *   - {@link openExcalidrawFile}: open an .excalidraw file via the OS open
 *     dialog, parse it, return the imported canvas.
 *
 * Architectural notes
 * -------------------
 *   - Tauri APIs are routed through the existing service-hub
 *     (`getServiceHub().dialog().{open,save}()` and
 *      `getServiceHub().core().invoke('write_file_sync' | 'read_file_sync', …)`),
 *     mirroring the convention already established by `compare-export.ts`.
 *     This file MUST NOT import directly from `@tauri-apps/plugin-*` —
 *     all wiring lives in the service hub.
 *   - Tauri capability surface: the `default.json` capability set already
 *     grants the Rust commands `open_dialog`, `save_dialog`,
 *     `read_file_sync`, and `write_file_sync` (via `core:default` /
 *     command registration in `src-tauri/src/lib.rs`). No new permissions
 *     are required, so the security surface is unchanged. The
 *     `tauri-plugin-fs` JS plugin is intentionally NOT used: the existing
 *     in-house Rust commands already cover read/write for absolute paths
 *     the user has explicitly chosen via the dialog.
 *   - PNG (binary) caveat: the existing `write_file_sync` Rust command
 *     accepts a `Vec<String>` and writes it through `fs::write(&path, &str)`,
 *     i.e. UTF-8 only. Binary PNG bytes can NOT round-trip through it.
 *     For now PNG saves through this module throw an `Error` instructing
 *     callers to fall back to the browser blob download path
 *     (`web-app/src/lib/canvas/download.ts`, T15). When a binary write
 *     command is added (or `tauri-plugin-fs` is wired), update the PNG
 *     branch below — the public signature already accepts `Blob`.
 *
 * Consumers (T18, T19, T22):
 *   - Toolbar export buttons (Save-As-…) — `saveCanvasFile`
 *   - Toolbar import button (Open .excalidraw) — `openExcalidrawFile`
 *   - Chat compose insert/import flow — both functions, gated on
 *     {@link isFileIoAvailable}.
 */

import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Supported save formats. PNG is currently desktop-unavailable (see file header). */
export type SaveFormat = 'png' | 'svg' | 'json' | 'excalidraw'

/**
 * Imported canvas payload — the shape produced by Excalidraw's "Save to disk"
 * command. The `name` is derived from the picked filename (stripped of its
 * extension) so the caller can seed the new canvas's display name.
 */
export type ImportedCanvas = {
  name: string
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export type SaveCanvasFileOptions = {
  /** Default filename (no path) suggested in the save dialog. */
  defaultName: string
  /** File format — drives the dialog filter and the encoding. */
  format: SaveFormat
  /**
   * Payload to write. `Blob` is intended for `png` (binary) once a binary
   * write command is wired; `string` is used for `svg`, `json`, and
   * `excalidraw` (all UTF-8 text formats).
   */
  data: Blob | string
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Returns `true` only when running inside Tauri (a real bridge is present).
 * Mobile and web builds return `false` and the chat compose / canvas toolbar
 * MUST hide the corresponding Export-File / Import-File controls.
 */
export function isFileIoAvailable(): boolean {
  return isPlatformTauri()
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const FORMAT_FILTERS: Record<
  SaveFormat,
  { name: string; extensions: [string] }
> = {
  png: { name: 'PNG image', extensions: ['png'] },
  svg: { name: 'SVG image', extensions: ['svg'] },
  json: { name: 'JSON file', extensions: ['json'] },
  excalidraw: { name: 'Excalidraw scene', extensions: ['excalidraw'] },
}

/**
 * Coerce a `Blob | string` payload to the UTF-8 string representation that
 * the in-house `write_file_sync` Rust command expects.
 *
 * For text formats (svg/json/.excalidraw), we either pass the string
 * straight through, or call `Blob.text()` if the caller handed us a Blob
 * (e.g. exporters return `Blob` from `exportToSvg`). For `png`, we throw —
 * see the file header for why.
 */
async function payloadToText(
  data: Blob | string,
  format: SaveFormat
): Promise<string> {
  if (format === 'png') {
    throw new Error(
      'errors.saveBinaryUnsupported: PNG export via Tauri is not yet supported. ' +
        'Use the browser download fallback (downloadBlob) instead.'
    )
  }

  if (typeof data === 'string') {
    return data
  }

  // Defensive: a Blob payload for a text format. Decode it as UTF-8.
  return data.text()
}

/**
 * Open the OS save dialog with a filter matching `format`, then write the
 * payload to the picked path.
 *
 * @returns the absolute path the user chose, or `null` if they cancelled.
 * @throws  on encoding / write failures — callers (T22) wrap in a toast
 *          using i18n keys.
 */
export async function saveCanvasFile(
  opts: SaveCanvasFileOptions
): Promise<string | null> {
  if (!isFileIoAvailable()) {
    throw new Error(
      'errors.fileIoUnavailable: file save is only available in the desktop app.'
    )
  }

  const filter = FORMAT_FILTERS[opts.format]
  if (!filter) {
    throw new Error(`errors.saveUnknownFormat: unknown format "${opts.format}"`)
  }

  // Compute the suggested filename. The dialog accepts `defaultPath`; we
  // append the extension if the caller forgot.
  const ext = filter.extensions[0]
  const suggested = opts.defaultName.toLowerCase().endsWith(`.${ext}`)
    ? opts.defaultName
    : `${opts.defaultName}.${ext}`

  const hub = getServiceHub()
  const path = await hub.dialog().save({
    defaultPath: suggested,
    filters: [filter],
  })

  if (path === null || path === undefined) {
    return null
  }

  // Encode payload AFTER the user committed to a path so we don't burn a
  // potentially-large `Blob.text()` decode if they cancel.
  const text = await payloadToText(opts.data, opts.format)

  await hub.core().invoke<void>('write_file_sync', { args: [path, text] })

  return path
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

/**
 * Type guard: does `value` look like an .excalidraw file payload?
 *
 * The official Excalidraw file format is a JSON object with at minimum:
 *   - `type: "excalidraw"`
 *   - `version: number` (currently `2`)
 *   - `elements: array`
 * `appState` and `files` are optional and we default them to safe values.
 *
 * See: https://docs.excalidraw.com/docs/codebase/json-schema
 */
function isExcalidrawFile(
  value: unknown
): value is {
  type: 'excalidraw'
  version?: number
  elements: readonly unknown[]
  appState?: Partial<AppState>
  files?: BinaryFiles
} {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.type === 'excalidraw' && Array.isArray(v.elements)
}

/**
 * Strip directory + extension from an absolute path, returning a sane
 * default canvas name. Works on both `\` and `/` separators.
 */
function basenameWithoutExtension(absPath: string): string {
  const lastSep = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'))
  const base = lastSep >= 0 ? absPath.slice(lastSep + 1) : absPath
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Open the OS open dialog filtered to `.excalidraw` files, read the picked
 * file, parse it as Excalidraw JSON, and return the imported canvas.
 *
 * @returns `{ path, canvas }` on success, or `null` if the user cancelled.
 * @throws  `Error` with message prefix `errors.importParseError:` when the
 *          file is not valid JSON, or not an .excalidraw payload. T22
 *          wraps the throw in a toast keyed off the prefix.
 */
export async function openExcalidrawFile(): Promise<
  { path: string; canvas: ImportedCanvas } | null
> {
  if (!isFileIoAvailable()) {
    throw new Error(
      'errors.fileIoUnavailable: file open is only available in the desktop app.'
    )
  }

  const hub = getServiceHub()
  const result = await hub.dialog().open({
    multiple: false,
    directory: false,
    filters: [FORMAT_FILTERS.excalidraw],
  })

  if (result === null || result === undefined) {
    return null
  }

  // `open` may return `string | string[]` depending on `multiple`. We asked
  // for a single file, but defend against both shapes.
  const path = Array.isArray(result) ? result[0] : result
  if (!path) {
    return null
  }

  const raw = await hub.core().invoke<string>('read_file_sync', { args: [path] })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `errors.importParseError: file is not valid JSON (${
        err instanceof Error ? err.message : String(err)
      })`
    )
  }

  if (!isExcalidrawFile(parsed)) {
    throw new Error(
      'errors.importParseError: file is missing required fields (expected `type: "excalidraw"` and `elements: array`)'
    )
  }

  const canvas: ImportedCanvas = {
    name: basenameWithoutExtension(path),
    // Excalidraw's published format declares `elements` as an opaque array;
    // we trust the validator above and let the consumer (`useCanvasStore.create`)
    // do scene-level validation downstream.
    elements: parsed.elements as readonly ExcalidrawElement[],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  }

  return { path, canvas }
}
