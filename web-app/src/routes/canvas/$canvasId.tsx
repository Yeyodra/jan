/**
 * Canvas detail route — `/canvas/$canvasId`.
 *
 * Composition (T12):
 *   - Reads `canvasId` from the URL.
 *   - Subscribes to {@link useCanvasStore} so renames/updates from anywhere
 *     in the app re-render this route.
 *   - Snapshots the FIRST `canvas` it sees into a ref keyed by id; that
 *     snapshot becomes Excalidraw's `initialScene`. Subsequent re-renders
 *     do NOT reload the scene — the editor is hydrated once and then the
 *     imperative API + auto-save handle drift.
 *   - Wires {@link useExcalidrawTheme} (T13) into `<CanvasEditor theme=...>`.
 *   - Wires {@link useCanvasAutoSave} (T14) → editor `onChange` + toolbar
 *     `saveStatus`.
 *   - Toolbar actions are dispatched through a single `handleAction` switch
 *     that reaches into the T15/T16/T17 helpers.
 *
 * Save strategy:
 *   - Desktop (Tauri): native save dialog via {@link saveCanvasFile}.
 *   - Web fallback: {@link downloadBlob} (PNG) or anchor-download a generated
 *     Blob for SVG/JSON.
 *   - PNG on desktop currently routes through `downloadBlob` because the
 *     in-house `write_file_sync` Rust command is UTF-8 only (see
 *     `lib/canvas/file-io.ts` header).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { toast } from 'sonner'

import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCanvasStore } from '@/stores/canvas-store'
import { useCanvasAutoSave } from '@/hooks/useCanvasAutoSave'
import { useExcalidrawTheme } from '@/hooks/useExcalidrawTheme'
import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import {
  CanvasEditor,
  type CanvasEditorInitialScene,
} from '@/components/canvas/CanvasEditor'
import {
  CanvasToolbar,
  type CanvasToolbarAction,
} from '@/components/canvas/CanvasToolbar'
import { CanvasRouteErrorComponent } from '@/components/canvas/CanvasErrorBoundary'
import {
  downloadBlob,
  exportCanvasToJson,
  exportCanvasToPng,
  exportCanvasToSvg,
} from '@/lib/canvas/exporters'
import { copyCanvasImageToClipboard } from '@/lib/canvas/clipboard'
import {
  isFileIoAvailable,
  openExcalidrawFile,
  saveCanvasFile,
} from '@/lib/canvas/file-io'
import type { Canvas, CanvasScene } from '@/types/canvas'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/canvas/$canvasId')({
  component: CanvasDetailRoute,
  errorComponent: CanvasRouteErrorComponent,
})

function CanvasDetailRoute() {
  const { canvasId } = useParams({ from: '/canvas/$canvasId' })
  // Live subscription — renames / duplicates / external updates re-render us.
  const canvas = useCanvasStore((s) => s.canvases[canvasId])

  if (!canvas) {
    return <CanvasNotFound />
  }

  // Use the (id) as a `key` so swapping to a different canvas remounts the
  // editor with a fresh `initialScene` snapshot.
  return <CanvasDetail key={canvas.id} canvas={canvas} />
}

// ---------------------------------------------------------------------------
// Not-found view
// ---------------------------------------------------------------------------

function CanvasNotFound() {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()
  return (
    <div
      data-testid="canvas-not-found"
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-12 text-center"
    >
      <p className="text-lg font-medium">{t('errors.canvasNotFound')}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate({ to: route.canvas })}
      >
        {t('toolbar.backToList')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail view (canvas guaranteed present)
// ---------------------------------------------------------------------------

interface CanvasDetailProps {
  canvas: Canvas
}

function CanvasDetail({ canvas }: CanvasDetailProps) {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()

  const theme = useExcalidrawTheme()

  // Snapshot the scene exactly once for Excalidraw's `initialData`. We do NOT
  // recompute this on re-render — the imperative API + auto-save own the
  // editor's mutable state from here on.
  const initialScene = useMemo<CanvasEditorInitialScene>(
    () => ({
      elements: canvas.elements,
      appState: canvas.appState as Record<string, unknown>,
      files: canvas.files as Record<string, unknown>,
    }),
    // Hydrate once per canvas id — snapshotting on later re-renders would
    // force-reseed the editor with stale data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas.id],
  )

  // Keep the imperative API for future use (theme sync, scene replacement
  // after import). Stored in a ref so re-renders don't churn it.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
  }, [])

  // Auto-save: the hook owns the debounce + status machine. We pull `flush`
  // out for the Ctrl/Cmd+S manual-save shortcut so users can force a write
  // without waiting for the debounce window.
  const { onChange, saveStatus, flush } = useCanvasAutoSave({
    canvasId: canvas.id,
    onSaveError: (err) => {
      // Translate the i18n key the lib layer uses to a real toast.
      toast.error(t('errors.saveFailed'), {
        description: err.message,
      })
    },
  })

  // ---- Dialog state -------------------------------------------------------

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(canvas.name)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ---- Action busy flag ---------------------------------------------------
  // While an export or copy is in flight we disable toolbar actions so the
  // user can't double-fire a long-running render.
  const [busy, setBusy] = useState(false)

  // ---- Live scene reader --------------------------------------------------
  /**
   * Read the freshest scene — the auto-save hook may not have flushed yet,
   * so we prefer the imperative API (which always reflects the current
   * editor state). Falls back to the persisted record.
   */
  const readLiveScene = useCallback((): CanvasScene => {
    const api = apiRef.current
    if (api) {
      return {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      }
    }
    return {
      elements: canvas.elements,
      appState: canvas.appState,
      files: canvas.files,
    }
  }, [canvas])

  // ---- Save helpers -------------------------------------------------------

  /**
   * Save a text payload (SVG / JSON / .excalidraw) — desktop uses Tauri's
   * native save dialog, web falls back to a synthetic anchor download.
   * Returns the picked path (desktop) or `null` (web fallback / cancel).
   */
  const saveText = useCallback(
    async (
      data: string,
      format: 'svg' | 'json' | 'excalidraw',
      filenameExt: string,
      mimeType: string,
    ): Promise<{ path: string | null; saved: boolean }> => {
      if (isFileIoAvailable()) {
        const path = await saveCanvasFile({
          defaultName: canvas.name,
          format,
          data,
        })
        return { path, saved: path !== null }
      }
      const blob = new Blob([data], { type: mimeType })
      downloadBlob(blob, `${canvas.name}.${filenameExt}`)
      return { path: null, saved: true }
    },
    [canvas.name],
  )

  /**
   * Save a PNG blob — desktop's write_file_sync is UTF-8-only today, so PNG
   * always flows through the browser download path.
   */
  const savePng = useCallback(
    (blob: Blob): { path: string | null; saved: boolean } => {
      downloadBlob(blob, `${canvas.name}.png`)
      return { path: null, saved: true }
    },
    [canvas.name],
  )

  // ---- Toolbar dispatcher -------------------------------------------------

  const handleAction = useCallback(
    async (action: CanvasToolbarAction) => {
      switch (action) {
        case 'png': {
          setBusy(true)
          try {
            const blob = await exportCanvasToPng(readLiveScene())
            savePng(blob)
            toast.success(
              t('export.pngSuccess', { path: `${canvas.name}.png` }),
            )
          } catch (err) {
            toast.error(t('errors.exportPngFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'svg': {
          setBusy(true)
          try {
            const svg = await exportCanvasToSvg(readLiveScene())
            const result = await saveText(
              svg,
              'svg',
              'svg',
              'image/svg+xml',
            )
            if (result.saved) {
              toast.success(
                t('export.svgSuccess', {
                  path: result.path ?? `${canvas.name}.svg`,
                }),
              )
            }
          } catch (err) {
            toast.error(t('errors.exportSvgFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'json':
        case 'exportFile': {
          setBusy(true)
          try {
            // Build a Canvas-shaped payload from the live scene so the
            // serializer sees the freshest elements/appState.
            const live = readLiveScene()
            const json = exportCanvasToJson({
              ...canvas,
              elements: live.elements,
              appState: live.appState,
              files: live.files,
            })
            const ext = action === 'exportFile' ? 'excalidraw' : 'json'
            const result = await saveText(
              json,
              action === 'exportFile' ? 'excalidraw' : 'json',
              ext,
              'application/json',
            )
            if (result.saved) {
              toast.success(
                t('export.jsonSuccess', {
                  path: result.path ?? `${canvas.name}.${ext}`,
                }),
              )
            }
          } catch (err) {
            toast.error(t('errors.exportJsonFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'importFile': {
          if (!isFileIoAvailable()) {
            toast.error(t('export.downloadDesktopOnly'))
            return
          }
          setBusy(true)
          try {
            const result = await openExcalidrawFile()
            if (!result) return // user cancelled
            const { canvas: imported } = result
            useCanvasStore.getState().update(canvas.id, {
              name: imported.name || canvas.name,
              elements: imported.elements as Canvas['elements'],
              appState: imported.appState,
              files: imported.files,
            })
            toast.success(t('import.successToast'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const key = msg.startsWith('errors.importParseError')
              ? 'errors.importParseError'
              : 'errors.importReadError'
            toast.error(t(key), { description: msg })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'copy': {
          setBusy(true)
          try {
            await copyCanvasImageToClipboard(readLiveScene())
            toast.success(t('export.copyImageSuccess'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const key =
              msg === 'errors.clipboardUnsupported'
                ? 'errors.clipboardUnsupported'
                : 'errors.clipboardFailed'
            toast.error(t(key))
          } finally {
            setBusy(false)
          }
          return
        }

        case 'rename': {
          setRenameValue(canvas.name)
          setRenameOpen(true)
          return
        }

        case 'duplicate': {
          const newId = useCanvasStore.getState().duplicate(canvas.id)
          if (newId) {
            toast.success(t('duplicate.successToast'))
            navigate({
              to: route.canvasDetail,
              params: { canvasId: newId },
            })
          }
          return
        }

        case 'delete': {
          setDeleteOpen(true)
          return
        }

        case 'back': {
          navigate({ to: route.canvas })
          return
        }
      }
    },
    [canvas, navigate, readLiveScene, savePng, saveText, t],
  )

  // ---- Keyboard shortcuts -------------------------------------------------
  //
  // Detail-view shortcuts. The shared `useKeyboardShortcut` hook fires on the
  // window and calls `e.preventDefault()` whenever the combo matches, so it
  // safely supersedes the browser's native Ctrl/Cmd+S save dialog.
  //
  // Excalidraw's own keyboard model:
  //   - Undo/redo, copy/paste, delete, arrow-nudge, zoom: handled by Excalidraw.
  //   - The hotkeys we register here (Ctrl/Cmd+S, Ctrl/Cmd+Shift+E, Ctrl/Cmd+I,
  //     Esc) are *not* Excalidraw-owned scene shortcuts, so intercepting them
  //     at the window level is non-disruptive — except while the user is
  //     editing text inside the canvas (Excalidraw mounts a real <textarea>
  //     for text tools). In that case we let the keystroke fall through.

  // Ctrl/Cmd+S → flush any pending auto-save write immediately.
  useKeyboardShortcut({
    key: 's',
    usePlatformMetaKey: true,
    callback: () => {
      flush()
      toast.success(t('shortcuts.savedToast'))
    },
  })

  // Ctrl/Cmd+Shift+E → quick-export current scene as PNG (matches the
  // toolbar's PNG action).
  useKeyboardShortcut({
    key: 'e',
    usePlatformMetaKey: true,
    shiftKey: true,
    callback: () => {
      void handleAction('png')
    },
  })

  // Esc → back to canvas list. Plain `window` listener (not the shared hook)
  // because:
  //   1. The shared hook always calls `preventDefault()`, which would swallow
  //      Esc keystrokes Excalidraw uses to deselect tools / exit edit mode.
  //   2. We need to bail when the active element is inside the editor or any
  //      input — Esc inside a dialog should close the dialog, not navigate.
  // The auto-save hook's unmount effect will flush any pending write before
  // navigation completes, so unsaved changes survive the back-navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null

      // Skip when typing — let the native handler do its thing.
      const editable =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      if (editable) return

      // Skip when focus is inside Excalidraw — its own Esc binding handles
      // tool deselect / edit-mode exit. The Excalidraw container exposes a
      // `.excalidraw` class on its outer element.
      if (target?.closest?.('.excalidraw')) return
      if (active?.closest?.('.excalidraw')) return

      e.preventDefault()
      navigate({ to: route.canvas })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // ---- Rename submit ------------------------------------------------------

  const submitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === canvas.name) {
      setRenameOpen(false)
      return
    }
    try {
      useCanvasStore.getState().rename(canvas.id, trimmed)
      setRenameOpen(false)
    } catch (err) {
      toast.error(t('errors.renameFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [canvas.id, canvas.name, renameValue, t])

  // ---- Delete confirm -----------------------------------------------------

  const confirmDelete = useCallback(() => {
    try {
      useCanvasStore.getState().delete(canvas.id)
      setDeleteOpen(false)
      navigate({ to: route.canvas })
    } catch (err) {
      toast.error(t('errors.deleteFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [canvas.id, navigate, t])

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex h-full w-full flex-col">
      <CanvasToolbar
        canvasName={canvas.name}
        saveStatus={saveStatus}
        onAction={handleAction}
        busy={busy}
      />
      <div className="flex-1 min-h-0">
        <CanvasEditor
          initialScene={initialScene}
          theme={theme}
          onChange={onChange}
          onApiReady={handleApiReady}
          className="h-full w-full"
        />
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rename.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label
              htmlFor="canvas-rename-input"
              className="text-sm font-medium"
            >
              {t('rename.label')}
            </label>
            <Input
              id="canvas-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t('rename.placeholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameOpen(false)}
            >
              {t('rename.cancel')}
            </Button>
            <Button type="button" onClick={submitRename}>
              {t('rename.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('delete.confirm', { name: canvas.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
            >
              {t('delete.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
            >
              {t('delete.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
