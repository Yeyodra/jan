import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
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
  /**
   * When provided, the debounced save callback returns early (skips the
   * write) while `isLockedRef.current === true`. This prevents redundant
   * IndexedDB writes during a batch of programmatic scene updates.
   *
   * Call `flushOnce()` (returned by the hook) immediately after setting
   * `isLockedRef.current = false` to trigger exactly one save once the
   * batch completes. Existing callers that omit this param are unaffected.
   */
  isLockedRef?: React.RefObject<boolean>
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
  /**
   * Bypass the debounce timer and trigger an immediate save. Intended for
   * use after a batch of programmatic scene updates: call once when the
   * manual-edit lock releases to flush the last pending scene in a single
   * write. No-op if nothing is pending.
   *
   * Unlike `flush` (which delegates to lodash debounced.flush and only fires
   * if a pending timer is queued), `flushOnce` calls the inner save fn
   * directly -- so it works even after the debounce timer already fired but
   * the lock guard caused it to return early.
   */
  flushOnce: () => void
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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
  const { canvasId, debounceMs = DEFAULT_DEBOUNCE_MS, onSaveError, isLockedRef } = opts

  const [saveStatus, setSaveStatus] = useState<CanvasSaveStatus>('saved')

  const pendingRef = useRef<PendingScene | null>(null)
  const lastElementsRef = useRef<readonly CanvasElement[] | null>(null)

  const onSaveErrorRef = useRef(onSaveError)
  useEffect(() => {
    onSaveErrorRef.current = onSaveError
  }, [onSaveError])

  const canvasIdRef = useRef(canvasId)

  // Core async save logic extracted into a ref so both the debounced wrapper
  // and flushOnce() can invoke it directly. The ref is updated on every
  // render so it always closes over the latest state setters and refs.
  const saveFnRef = useRef<() => Promise<void>>(async () => {})

  // Keep saveFnRef current. We reassign on every render (cheap) so the
  // debounced fn always calls the latest version without needing recreation.
  saveFnRef.current = async () => {
    // Skip save while a batch of programmatic edits is in progress.
    // The caller sets isLockedRef.current = false then calls flushOnce()
    // to persist the last scene exactly once after the batch completes.
    if (isLockedRef?.current === true) return

    const pending = pendingRef.current
    if (!pending) return
    const targetId = canvasIdRef.current

    setSaveStatus('saving')
    try {
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
      pendingRef.current = null
      setSaveStatus('saved')
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error('[useCanvasAutoSave] failed to persist canvas', error)
      setSaveStatus('error')
      onSaveErrorRef.current?.(error)
    }
  }

  // Build the debounced wrapper ONCE per debounceMs. It delegates to saveFnRef
  // so it always calls the latest save logic without needing recreation.
  const debounced = useMemo(
    () =>
      debounce(
        async () => {
          await saveFnRef.current()
        },
        debounceMs,
        { leading: false, trailing: true }
      ),
    [debounceMs]
  )

  // Keep canvasIdRef in sync.
  useEffect(() => {
    if (canvasIdRef.current !== canvasId) {
      debounced.flush()
      canvasIdRef.current = canvasId
      lastElementsRef.current = null
    }
  }, [canvasId, debounced])

  // Unmount: flush pending change, then cancel the timer.
  useEffect(() => {
    return () => {
      debounced.flush()
      debounced.cancel()
    }
  }, [debounced])

  const onChange = useCallback<CanvasEditorChangeHandler>(
    (elements, appState, files) => {
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

  const flush = useCallback(() => {
    debounced.flush()
  }, [debounced])

  // flushOnce: calls saveFnRef directly, bypassing lodash pending-call
  // bookkeeping. Used by the lock-release subscription in the canvas route
  // to persist the last pending scene exactly once after a batch completes.
  const flushOnce = useCallback(() => {
    void saveFnRef.current()
  }, [])

  return { onChange, saveStatus, flush, flushOnce }
}