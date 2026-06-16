/**
 * CanvasCard — list-item tile for a single canvas in the canvas list view (T11).
 *
 * Pure presentation: receives a {@link CanvasMeta} projection plus four callbacks
 * (open / rename / duplicate / delete) and never reaches into the Zustand store.
 * Navigation, confirm dialogs, and store mutations are owned by the parent route.
 *
 * Accessibility:
 *   - The card body is a `<button>`, so Enter/Space fire `onOpen` for free.
 *   - The overflow-menu trigger is a separate `<button>` with `stopPropagation`
 *     so opening the menu never also opens the canvas.
 *   - Menu items are keyboard-navigable via Radix DropdownMenu primitives.
 *
 * i18n:
 *   - All visible strings come from the `canvas` namespace (T02).
 *   - `list.elementCount` uses i18next pluralisation (`_one` / `_other`).
 *   - `list.lastEdited` interpolates `{{date}}`; we feed it a relative-time string
 *     produced by `Intl.RelativeTimeFormat` (no `date-fns` dep in this workspace).
 */

import { memo, useCallback, useMemo } from 'react'
import { MoreHorizontal, Copy, Pencil, Trash2 } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CanvasIcon } from '@/components/animated-icon/canvas'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import type { CanvasMeta } from '@/types/canvas'

export interface CanvasCardProps {
  meta: CanvasMeta
  onOpen: (id: string) => void
  onRename: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  className?: string
}

/**
 * Format an ISO timestamp as a short relative phrase ("2h ago", "yesterday", "3 days ago").
 * Falls back to a localized date for anything older than ~30 days so the card stays useful.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const now = Date.now()
  const diffSec = Math.round((then - now) / 1000)
  const absSec = Math.abs(diffSec)

  // Older than 30 days: switch to absolute date — relative loses meaning.
  if (absSec > 60 * 60 * 24 * 30) {
    return new Date(iso).toLocaleDateString()
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  const ladder: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ]

  for (const [unit, secondsInUnit] of ladder) {
    if (absSec >= secondsInUnit || unit === 'second') {
      const value = Math.round(diffSec / secondsInUnit)
      return rtf.format(value, unit)
    }
  }
  return rtf.format(diffSec, 'second')
}

function CanvasCardImpl({
  meta,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  className,
}: CanvasCardProps) {
  const { t } = useTranslation('canvas')

  const relative = useMemo(() => formatRelative(meta.updatedAt), [meta.updatedAt])

  const handleOpen = useCallback(() => {
    onOpen(meta.id)
  }, [meta.id, onOpen])

  // Stop propagation on the menu trigger's pointer/click so opening the menu
  // never bubbles up and triggers `onOpen` on the surrounding card button.
  const stop = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation()
  }, [])

  const displayName = meta.name?.trim() || t('untitledCanvas')

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm transition-all',
        'hover:border-foreground/20 hover:shadow-md',
        'focus-within:border-foreground/30 focus-within:ring-2 focus-within:ring-ring/40',
        className
      )}
    >
      {/* Whole-card click target: a real <button> so Enter/Space and screen-reader
          semantics come for free. Sits as the first child so the dropdown trigger
          can stack above it absolutely. */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label={t('list.openCanvas')}
        className="flex flex-col text-left outline-none"
      >
        {/* Thumbnail / placeholder */}
        <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border bg-muted/40">
          {meta.thumbnail ? (
            <img
              src={meta.thumbnail}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground/60">
              <CanvasIcon size={48} />
            </div>
          )}

          {/* Element count badge — bottom-right of the thumbnail */}
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-background/80 px-2 py-0.5 text-xs font-medium text-foreground shadow-sm backdrop-blur-sm">
            {t('list.elementCount', { count: meta.elementCount })}
          </span>
        </div>

        {/* Body: title + relative timestamp */}
        <div className="flex flex-col gap-1 p-4 pr-12">
          <h3 className="truncate text-sm font-medium text-foreground">
            {displayName}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t('list.lastEdited', { date: relative })}
          </p>
        </div>
      </button>

      {/* Overflow menu — absolutely positioned over the body's right padding so it
          floats above the card-button without being a child of it. */}
      <div className="absolute right-3 bottom-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={stop}
              onPointerDown={stop}
              aria-label={t('toolbar.moreActions')}
              className={cn(
                'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground',
                'opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground',
                'group-hover:opacity-100 focus-visible:opacity-100',
                'data-[state=open]:opacity-100 data-[state=open]:bg-accent'
              )}
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="w-44"
            onClick={stop}
          >
            <DropdownMenuItem onSelect={() => onRename(meta.id)}>
              <Pencil className="size-4" />
              <span>{t('toolbar.rename')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(meta.id)}>
              <Copy className="size-4" />
              <span>{t('toolbar.duplicate')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(meta.id)}
            >
              <Trash2 className="size-4" />
              <span>{t('toolbar.delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

/**
 * `memo` because the list view (T11) re-renders frequently as canvases are
 * created/renamed; the per-card props are stable references when the parent
 * memoises its callbacks.
 */
export const CanvasCard = memo(CanvasCardImpl)
CanvasCard.displayName = 'CanvasCard'

export default CanvasCard
