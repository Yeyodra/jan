/**
 * useCanvasAutoSave — debounced auto-save bridge between `<CanvasEditor>` and
 * the canvas Zustand store.
 *
 * Wiring (T14):
 *   const { onChange, saveStatus, flush } = useCanvasAutoSave({ canvasId })
 *   <CanvasEditor onChange={onChange} ... />
 *
 * Why a hook (not effect-in-route)?
 *   The detail route (T12) needs both the change handler and the live status
 *   pill in the toolbar. Co-locating "debounce + status machine" here keeps
 *   the route thin and makes the contract testable in isolation.
 *
 * Status machine (drives the toolbar pill):
 *   idle ──onChange──▶ unsaved ──debounce fires──▶ saving ──ok──▶ saved
 *                                                          └──err─▶ error
 *
 * Stale-closure / unmount-flush hazard:
 *   Excalidraw fires `onChange` at frame rate. We must NOT recreate the
 *   debounced function on every render — that would reset the trailing
 *   timer and effectively never save while the user keeps drawing. Instead
 *   we keep ONE debounced fn for the lifetime of the hook (in a ref), and
 *   the latest scene values in another ref. The debounced fn pulls from
 *   the ref at fire time, so we never close over stale snapshots.
 *
 *   On unmount we call `debounced.flush()` — lodash will run the trailing
 *   call synchronously if one is pending. The actual `update()` is a
 *   synchronous Zustand `set`, so the write completes before React
 *   continues unmounting. No async race.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import debounce from 'lodash.debounce'
import { useCanvasStore } from '@/stores/canvas-store'
import { generateCanvasThumbnail } from '@/lib/canvas/thumbnail'
import type { CanvasEditorChangeHandler } from '@/components/canvas/CanvasEditor'
import type {
  CanvasAppState,
  CanvasBinaryFiles,
  CanvasElement,
} from '@/stores/canvas-store'
import type { CanvasScene } from '@/types/canvas'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CanvasSaveStatus = 'saving' | 'saved' | 'unsaved' | 'error'

export interface UseCanvasAutoSaveOptions {
  /** ID of the canvas being edited. Updates target this row. */
  canvasId: string
  /** Trailing debounce window in ms. Default 800. */
  debounceMs?: number
  /** Optional sink for surfacing save errors (toast, telemetry, etc.). */
  onSaveError?: (err: Error) => void
}

export interface UseCanvasAutoSaveResult {
  /** Wire directly to `<CanvasEditor onChange={...}>`. */
  onChange: CanvasEditorChangeHandler
  /** Live save state for the toolbar pill. */
  saveStatus: CanvasSaveStatus
  /**
   * Force-write any pending debounced change immediately. Safe to call from
   * "back" buttons or anywhere the user is about to navigate away. No-op if
   * nothing is pending.
   */
  flush: () => void
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Snapshot the editor handed us most recently. Held in a ref so the
 * (long-lived) debounced fn always reads the freshest scene rather than a
 * closed-over stale copy.
 */
interface PendingScene {
  elements: readonly CanvasElement[]
  appState: CanvasAppState
  files: CanvasBinaryFiles
}

const DEFAULT_DEBOUNCE_MS = 800

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCanvasAutoSave(
  opts: UseCanvasAutoSaveOptions
): UseCanvasAutoSaveResult {
  const { canvasId, debounceMs = DEFAULT_DEBOUNCE_MS, onSaveError } = opts

  const [saveStatus, setSaveStatus] = useState<CanvasSaveStatus>('saved')

  // Latest scene the editor pushed at us. The debounced writer reads from
  // here at fire time so we never persist a stale frame.
  const pendingRef = useRef<PendingScene | null>(null)

  // Last elements array reference we accepted as "actually changed". Excalidraw
  // emits onChange even on no-op events (pointer hover, focus blur); the array
  // identity changes only when the scene mutates, so a !== check is enough to
  // skip flooding the debounce queue with frame-rate noise.
  const lastElementsRef = useRef<readonly CanvasElement[] | null>(null)

  // Latest error sink — captured in a ref so the debounced fn (created once)
  // can surface errors without forcing recreation when the caller swaps the
  // handler identity.
  const onSaveErrorRef = useRef(onSaveError)
  useEffect(() => {
    onSaveErrorRef.current = onSaveError
  }, [onSaveError])

  // Latest canvasId — same rationale as above. The detail route should not
  // remount the editor when the route param changes, so the hook tolerates
  // a canvasId swap without losing pending work (the old pending write,
  // if any, gets flushed against the OLD id by the cleanup below).
  const canvasIdRef = useRef(canvasId)

  // Build the debounced writer ONCE per (debounceMs) — the function reads
  // everything it needs from refs, so its identity never needs to change
  // due to caller-supplied options drifting.
  const debounced = useMemo(
    () =>
      debounce(
        // The save is async because thumbnail generation goes through
        // Excalidraw's `exportToSvg` which is itself async (font loading
        // happens during export). We still update Zustand synchronously
        // once the SVG is ready — Zustand's `set` is sync; only the SVG
        // serialization adds latency.
        async () => {
          const pending = pendingRef.current
          if (!pending) return
          const targetId = canvasIdRef.current

          setSaveStatus('saving')
          try {
            // Generate a card thumbnail off the same scene we're about to
            // persist. Empty scenes / failures resolve to `null`; in that
            // case we skip the field on the update payload so the
            // last-known-good thumbnail (if any) is preserved.
            const scene: CanvasScene = {
              elements: pending.elements as CanvasElement[],
              appState: pending.appState,
              files: pending.files,
            }
            const thumbnail = await generateCanvasThumbnail(scene)

            useCanvasStore.getState().update(targetId, {
              elements: pending.elements as CanvasElement[],
              appState: pending.appState,
              files: pending.files,
              ...(thumbnail !== null ? { thumbnail } : {}),
            })
            // Successful write — drain the pending slot so a subsequent
            // flush() is a no-op rather than a duplicate write.
            pendingRef.current = null
            setSaveStatus('saved')
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            console.error('[useCanvasAutoSave] failed to persist canvas', error)
            setSaveStatus('error')
            onSaveErrorRef.current?.(error)
            // Keep `pendingRef` populated so the next onChange (or an
            // explicit flush) retries automatically.
          }
        },
        debounceMs,
        { leading: false, trailing: true }
      ),
    [debounceMs]
  )

  // Keep canvasIdRef in sync. If the consumer flipped to a different canvas
  // while a write was queued, flush against the OLD id first so we don't
  // accidentally write Canvas-A's elements into Canvas-B's row.
  useEffect(() => {
    if (canvasIdRef.current !== canvasId) {
      // Drain pending work for the previous id BEFORE we swap.
      debounced.flush()
      canvasIdRef.current = canvasId
      // Reset dedupe baseline — different canvas, different element identity
      // expectations.
      lastElementsRef.current = null
    }
  }, [canvasId, debounced])

  // Unmount: flush any pending change so navigation doesn't lose work, then
  // cancel to drop the timer reference. `flush()` runs the trailing call
  // synchronously if one is pending, which is exactly the unmount semantics
  // we need (Zustand `set` is synchronous; the IDB persist write happens
  // out-of-band but the in-memory store is updated before unmount completes).
  useEffect(() => {
    return () => {
      debounced.flush()
      debounced.cancel()
    }
  }, [debounced])

  // Public onChange. Stable identity (does not recreate per render) because
  // it only reads/writes refs and a stable debounced fn.
  const onChange = useCallback<CanvasEditorChangeHandler>(
    (elements, appState, files) => {
      // Dedupe frame-rate noise: same array reference => no scene mutation.
      if (elements === lastElementsRef.current) return
      lastElementsRef.current = elements

      pendingRef.current = {
        elements: elements as readonly CanvasElement[],
        appState: appState as CanvasAppState,
        files: files as CanvasBinaryFiles,
      }
      setSaveStatus('unsaved')
      debounced()
    },
    [debounced]
  )

  // Imperative flush — exposed for "back" buttons, route-leave guards, etc.
  // Same contract as the unmount cleanup but callable on demand.
  const flush = useCallback(() => {
    debounced.flush()
  }, [debounced])

  return { onChange, saveStatus, flush }
}
