/**
 * Canvas list route — `/canvas/`.
 *
 * TanStack Router file-based: this file's path (`routes/canvas/index.tsx`) is
 * automatically registered as the `/canvas/` route. We pass the generated
 * literal directly to `createFileRoute` (mirroring `$canvasId.tsx`) so the
 * route id is statically typed without a cast.
 *
 * Responsibilities:
 *   - Show a header with title + "New canvas" button
 *   - Show a centered empty state when the user has no canvases
 *   - Otherwise show a responsive grid of `<CanvasCard>` ordered by `updatedAt` desc
 *   - Own the rename and delete confirm dialogs (CanvasCard is presentational)
 *
 * What this route DOES NOT do:
 *   - Load Excalidraw — only the detail route does
 *   - Search / sort / filter — list-view v1 is recency-sorted only
 *   - Mutate any sidebar/nav state
 */

import { useCallback, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCanvasStore } from '@/stores/canvas-store'
import type { Canvas, CanvasMeta } from '@/types/canvas'
import { CanvasCard } from '@/components/canvas/CanvasCard'
import { CanvasIcon } from '@/components/animated-icon/canvas'
import { CanvasRouteErrorComponent } from '@/components/canvas/CanvasErrorBoundary'
import HeaderPage from '@/containers/HeaderPage'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { IconPlus } from '@tabler/icons-react'

export const Route = createFileRoute('/canvas/')({
  component: CanvasListPage,
  errorComponent: CanvasRouteErrorComponent,
})

/**
 * Project a full `Canvas` (store shape) down to the lightweight `CanvasMeta`
 * the card component expects. Keeps the card decoupled from store internals.
 */
function toMeta(c: Canvas): CanvasMeta {
  return {
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    elementCount: c.elements.length,
    thumbnail: c.thumbnail,
  }
}

export function CanvasListPage() {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()

  // Subscribe to the live `canvases` record so the grid re-renders on any
  // create/rename/delete/duplicate. We sort here (cheap) instead of subscribing
  // to a getter, because Zustand getters don't trigger re-renders by reference.
  const canvases = useCanvasStore((s) => s.canvases)

  const orderedMetas = useMemo<CanvasMeta[]>(() => {
    return Object.values(canvases)
      .sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
      )
      .map(toMeta)
  }, [canvases])

  // ----- New canvas ---------------------------------------------------------
  const handleCreate = useCallback(() => {
    try {
      const id = useCanvasStore.getState().create(t('untitledCanvas'))
      navigate({
        to: route.canvasDetail,
        params: { canvasId: id },
      })
    } catch {
      toast.error(t('errors.createFailed'))
    }
  }, [navigate, t])

  // ----- Open ---------------------------------------------------------------
  const handleOpen = useCallback(
    (id: string) => {
      navigate({
        to: route.canvasDetail,
        params: { canvasId: id },
      })
    },
    [navigate]
  )

  // ----- Duplicate ----------------------------------------------------------
  const handleDuplicate = useCallback(
    (id: string) => {
      try {
        const newId = useCanvasStore.getState().duplicate(id)
        if (!newId) {
          toast.error(t('errors.canvasNotFound'))
          return
        }
        toast.success(t('duplicate.successToast'))
      } catch {
        toast.error(t('errors.createFailed'))
      }
    },
    [t]
  )

  // ----- Rename dialog ------------------------------------------------------
  const [renameTarget, setRenameTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  const openRenameFor = useCallback(
    (id: string) => {
      const c = useCanvasStore.getState().get(id)
      if (!c) {
        toast.error(t('errors.canvasNotFound'))
        return
      }
      setRenameTarget({ id, name: c.name })
    },
    [t]
  )

  const closeRename = useCallback(() => setRenameTarget(null), [])

  const handleRenameSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!renameTarget) return
      const trimmed = renameTarget.name.trim()
      const finalName = trimmed.length > 0 ? trimmed : t('untitledCanvas')
      try {
        useCanvasStore.getState().rename(renameTarget.id, finalName)
        setRenameTarget(null)
      } catch {
        toast.error(t('errors.renameFailed'))
      }
    },
    [renameTarget, t]
  )

  // ----- Delete confirm dialog ----------------------------------------------
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  const openDeleteFor = useCallback(
    (id: string) => {
      const c = useCanvasStore.getState().get(id)
      if (!c) {
        toast.error(t('errors.canvasNotFound'))
        return
      }
      setDeleteTarget({ id, name: c.name })
    },
    [t]
  )

  const closeDelete = useCallback(() => setDeleteTarget(null), [])

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return
    try {
      useCanvasStore.getState().delete(deleteTarget.id)
      setDeleteTarget(null)
    } catch {
      toast.error(t('errors.deleteFailed'))
    }
  }, [deleteTarget, t])

  // -------------------------------------------------------------------------

  const isEmpty = orderedMetas.length === 0
  const trimmedDeleteName = deleteTarget?.name?.trim()

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <HeaderPage>
        {/*
         * `relative z-20` matches the global Tauri drag region in `__root.tsx`
         * (a `fixed w-full h-12 z-20` overlay). Same z + later-in-DOM means
         * the header content visually wins inside its own box, so the
         * "New canvas" button responds to clicks instead of the cursor
         * turning into a grab. `WindowControls` (`z-50`) still floats above
         * us in the top-right corner. `!IS_MACOS && pr-30` reserves room for
         * those `close/minimize/maximize` controls. Mirrors the canonical
         * pattern used by `routes/hub/index.tsx` (line 423).
         */}
        <div
          className={cn(
            'relative z-20 flex w-full items-center gap-3 py-3',
            !IS_MACOS ? 'pr-30' : 'pr-4',
          )}
        >
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">
              {t('list.heading')}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {t('subtitle')}
            </p>
          </div>

          {/*
           * Middle drag spacer — `flex-1` pushes the right group to the edge
           * (replaces the parent's removed `justify-between`). On Tauri
           * desktop (macOS + Windows) it carries `data-tauri-drag-region` so
           * the user can drag the window from the empty band between the
           * page title and the "New canvas" button. Linux ignores the
           * attribute and web doesn't have a window to drag — both still
           * get the spacer (so the layout stays identical), just without
           * the drag handle.
           */}
          <div
            className={cn(
              'flex-1 self-stretch',
              IS_TAURI && !IS_LINUX && 'cursor-grab active:cursor-grabbing',
            )}
            {...(IS_TAURI && !IS_LINUX
              ? ({
                  'data-tauri-drag-region': '',
                  'aria-label': 'Drag window',
                } as Record<string, string>)
              : {})}
          />

          <Button
            size="sm"
            onClick={handleCreate}
            data-testid="canvas-create-button"
          >
            <IconPlus className="size-4" />
            <span>{t('newCanvas')}</span>
          </Button>
        </div>
      </HeaderPage>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div
            data-testid="canvas-empty-state"
            className="flex h-full flex-col items-center justify-center gap-6 px-6 py-16 text-center"
          >
            <div
              aria-hidden
              className="relative flex size-32 items-center justify-center rounded-3xl bg-gradient-to-br from-muted/60 to-muted/20 text-muted-foreground ring-1 ring-border/60 shadow-sm"
            >
              <CanvasIcon size={72} />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                {t('empty.title')}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('empty.description')}
              </p>
            </div>
            <Button
              size="lg"
              onClick={handleCreate}
              data-testid="canvas-create-empty-cta"
            >
              <IconPlus className="size-4" />
              <span>{t('empty.cta')}</span>
            </Button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div
              className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
              data-testid="canvas-grid"
            >
              {orderedMetas.map((meta) => (
                <CanvasCard
                  key={meta.id}
                  meta={meta}
                  onOpen={handleOpen}
                  onRename={openRenameFor}
                  onDuplicate={handleDuplicate}
                  onDelete={openDeleteFor}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ----- Rename dialog ------------------------------------------------ */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && closeRename()}
      >
        <DialogContent showCloseButton={false}>
          <form onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>{t('rename.dialogTitle')}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('rename.label')}
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 flex flex-col gap-2">
              <label
                htmlFor="canvas-rename-input"
                className="text-sm font-medium text-foreground"
              >
                {t('rename.label')}
              </label>
              <Input
                id="canvas-rename-input"
                autoFocus
                value={renameTarget?.name ?? ''}
                onChange={(e) =>
                  setRenameTarget((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev
                  )
                }
                placeholder={t('rename.placeholder')}
                data-testid="canvas-rename-input"
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">
                  {t('rename.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm">
                {t('rename.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ----- Delete confirm dialog --------------------------------------- */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && closeDelete()}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('delete.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {trimmedDeleteName && trimmedDeleteName.length > 0
                ? t('delete.confirm', { name: trimmedDeleteName })
                : t('delete.confirmGeneric')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm">
                {t('delete.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
              data-testid="canvas-delete-confirm"
            >
              {t('delete.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
