/**
 * CanvasToolbar — the action bar that sits above the Excalidraw editor on the
 * canvas detail route. Pure dispatcher: every button calls `onAction(...)`
 * and the parent route (T12) is responsible for performing the actual export,
 * clipboard write, navigation, etc.
 *
 * Layout:
 *   [back-arrow]  [canvas name (click → rename)]  ────  [save status]  [⋯]
 *
 * Insert-to-chat, Copy, and Export (PNG, SVG, JSON, .excalidraw) used to live
 * here but were removed: Copy / Export already exist inside Excalidraw's own
 * built-in canvas menu (hamburger icon at the top-left of the canvas itself,
 * plus Ctrl/Cmd+C), and Insert-to-chat was scoped out by the user. The ⋯
 * dropdown still owns Import .excalidraw / Duplicate / Delete because those
 * are jan-specific store mutations Excalidraw can't drive.
 *
 * Design system anchors:
 *   - `Button` from `@/components/ui/button` for every interactive control.
 *   - `Tooltip` from `@/components/ui/tooltip` wraps every icon-only control.
 *   - `DropdownMenu` from `@/components/ui/dropdown-menu` for Export + More.
 *   - Spacing/typography use Tailwind tokens already used elsewhere
 *     (`gap-2`, `px-4`, `text-sm`, `text-muted-foreground`, etc.).
 *   - Save-status colors use the semantic palette: `text-muted-foreground`
 *     (saved), `text-amber-500` (unsaved), `text-destructive` (error).
 *
 * The toolbar dispatches NO async work itself — it only fires `onAction`.
 * `busy` disables every action button while a parent-driven export is
 * in-flight.
 */
import {
  ChevronLeft,
  Copy,
  MoreVertical,
  Pencil,
  Trash2,
  Upload,
  Check,
  Loader2,
  AlertCircle,
  Circle,
} from 'lucide-react'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'

export type CanvasToolbarAction =
  | 'png'
  | 'svg'
  | 'json'
  | 'copy'
  | 'exportFile'
  | 'importFile'
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'back'

export type CanvasSaveStatus = 'saving' | 'saved' | 'unsaved' | 'error'

export interface CanvasToolbarProps {
  canvasName: string
  saveStatus: CanvasSaveStatus
  onAction: (action: CanvasToolbarAction) => void
  busy?: boolean
}

/**
 * Renders the save-status pill on the right of the toolbar. The icon and
 * color shift with the status; only the text is translated.
 */
function SaveStatusPill({ status }: { status: CanvasSaveStatus }) {
  const { t } = useTranslation('canvas')

  // Map status → { icon, label, className }. Keeping this inline rather than
  // splitting into a config object — there are only four cases and inlining
  // is easier to read at a glance.
  if (status === 'saving') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        <span>{t('toolbar.saving')}</span>
      </span>
    )
  }

  if (status === 'unsaved') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 text-xs text-amber-500"
      >
        <Circle className="size-2 fill-current" />
        <span>{t('status.unsavedChanges')}</span>
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 text-xs text-destructive"
      >
        <AlertCircle className="size-3.5" />
        <span>{t('errors.saveFailed')}</span>
      </span>
    )
  }

  // status === 'saved'
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Check className="size-3.5" />
      <span>{t('status.allChangesSaved')}</span>
    </span>
  )
}

export function CanvasToolbar({
  canvasName,
  saveStatus,
  onAction,
  busy = false,
}: CanvasToolbarProps) {
  const { t } = useTranslation('canvas')
  const { open: leftPanelOpen } = useLeftPanel()

  const fire = (action: CanvasToolbarAction) => () => onAction(action)

  return (
    <TooltipProvider delayDuration={150}>
      {/*
       * `relative z-20` matches the global Tauri drag region in `__root.tsx`
       * (a `fixed w-full h-12 z-20 top-0` overlay). Same z + later-in-DOM
       * means the toolbar visually wins inside its own box, so buttons get
       * pointer events instead of a grab cursor — but `WindowControls` (at
       * `z-50`, also rendered before the Outlet) still floats above us in the
       * top-right corner. This mirrors the canonical pattern in
       * `routes/hub/index.tsx` (line 423).
       *
       * Because we cover the global drag region in our box, we mint a local
       * drag zone in the middle of the toolbar (the spacer below) so the user
       * can still drag the window from the toolbar.
       *
       * Horizontal padding is platform-aware:
       *   - macOS: when the left sidebar is closed, reserve `pl-24` so the
       *     native traffic-light controls don't overlap the back button.
       *   - Windows + Linux: reserve `pr-30` for the absolutely-positioned
       *     `WindowControls` (close/minimize/maximize) on the right.
       */}
      <div
        className={cn(
          'relative z-20 flex w-full items-center gap-3 border-b bg-background py-2',
          IS_MACOS && !leftPanelOpen ? 'pl-24' : 'pl-4',
          !IS_MACOS ? 'pr-30' : 'pr-4',
        )}
      >
        {/* LEFT: back + canvas name (clickable to rename) */}
        <div className="flex min-w-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={fire('back')}
                disabled={busy}
                aria-label={t('toolbar.backToList')}
              >
                <ChevronLeft className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('toolbar.backToList')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={fire('rename')}
                disabled={busy}
                className={cn(
                  'group inline-flex min-w-0 max-w-[40ch] items-center gap-1.5 rounded-md px-2 py-1',
                  'text-sm font-medium text-foreground',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
                aria-label={t('toolbar.rename')}
              >
                <span className="truncate">{canvasName}</span>
                <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {t('toolbar.rename')}
            </TooltipContent>
          </Tooltip>
        </div>

        {/*
         * Middle drag spacer — `flex-1` pushes the right group to the edge
         * (replaces the parent's removed `justify-between`). On Tauri
         * desktop (macOS + Windows) it carries `data-tauri-drag-region` so
         * the user can drag the window from the empty band between the
         * canvas-name and the action group. Linux ignores the attribute and
         * web doesn't have a window to drag — both still get the spacer (so
         * the layout stays identical), just without the drag handle.
         */}
        <div
          className={cn(
            'flex-1 self-stretch',
            IS_TAURI && !IS_LINUX && 'cursor-grab active:cursor-grabbing',
          )}
          {...(IS_TAURI && !IS_LINUX
            ? { 'data-tauri-drag-region': '', 'aria-label': 'Drag window' }
            : {})}
        />

        {/* RIGHT: save status + actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <SaveStatusPill status={saveStatus} />

          <span className="mx-1 h-5 w-px bg-border" aria-hidden />

          {/* NOTE: Insert-to-chat, Copy-image, and Export (PNG / SVG / JSON
              / .excalidraw) buttons were intentionally removed. Excalidraw's
              own canvas menu (hamburger icon at the top-left of the canvas
              itself, plus Ctrl/Cmd+C) ships the export and clipboard actions,
              and the in-house Insert-to-Chat path was scoped out by the user.
              The dispatcher in `$canvasId.tsx` still handles those cases on
              `CanvasToolbarAction` for programmatic callers (AI tool calls,
              the Ctrl+Cmd+S manual save shortcut, etc.) — no toolbar surface
              fires them anymore. */}

          {/* More-actions dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t('toolbar.moreActions')}
                  >
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t('toolbar.moreActions')}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={fire('importFile')}
                disabled={busy}
              >
                <Upload className="text-muted-foreground" />
                <span>{t('toolbar.importExcalidraw')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={fire('duplicate')} disabled={busy}>
                <Copy className="text-muted-foreground" />
                <span>{t('toolbar.duplicate')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={fire('delete')}
                disabled={busy}
              >
                <Trash2 />
                <span>{t('toolbar.delete')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default CanvasToolbar
