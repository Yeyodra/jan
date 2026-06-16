import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { IconLayoutSidebar } from '@tabler/icons-react'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface CompareHeaderProps {
  canClear: boolean
  isAnyStreaming: boolean
  onClearAll: () => void
}

export function CompareHeader({
  canClear,
  isAnyStreaming,
  onClearAll,
}: CompareHeaderProps) {
  const { t } = useTranslation('compare')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { open: leftPanelOpen, setLeftPanel } = useLeftPanel()
  const clearDisabled = !canClear || isAnyStreaming

  const clearButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        if (!clearDisabled) setConfirmOpen(true)
      }}
      disabled={clearDisabled}
      aria-label={t('clearAll')}
    >
      <Trash2 className="size-4" />
      {t('clearAll')}
    </Button>
  )

  const handleConfirm = () => {
    setConfirmOpen(false)
    onClearAll()
  }

  // Reserve space on the right for the Tauri WindowControls (Windows-only),
  // which are absolutely positioned at top-0 right-4 with 3 icon-sm buttons
  // (~28px each → ~84px + right-4 offset). pr-28 keeps the Clear all button
  // clear of the close/minimize/maximize icons.
  const rightPadding =
    IS_TAURI && IS_WINDOWS ? 'pr-28' : 'pr-4'

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 py-3 border-b',
        IS_MACOS && !leftPanelOpen ? 'pl-24' : 'pl-4',
        rightPadding
      )}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {!leftPanelOpen && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full relative z-50 mt-0.5 shrink-0"
            onClick={() => setLeftPanel(true)}
            aria-label="Toggle sidebar"
          >
            <IconLayoutSidebar className="text-muted-foreground relative size-4.5" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{t('title')}</h1>
          <p className="text-sm text-muted-foreground truncate">
            {t('subtitle')}
          </p>
        </div>
      </div>
      <div className="relative z-30 flex items-center gap-2 shrink-0">
        <TooltipProvider delayDuration={300}>
          {clearDisabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex">
                  {clearButton}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isAnyStreaming ? t('stopAll') : t('emptyColumn')}
              </TooltipContent>
            </Tooltip>
          ) : (
            clearButton
          )}
        </TooltipProvider>

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('clearAll')}</DialogTitle>
              <DialogDescription>{t('clearAllConfirm')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirm}
              >
                {t('clearAll')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

export default CompareHeader
