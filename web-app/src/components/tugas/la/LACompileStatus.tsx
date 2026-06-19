import { useTranslation } from '@/i18n/react-i18next-compat'
import type { CompileStatus } from '@/types/tugas'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

interface LACompileStatusProps {
  status: CompileStatus
  progress: number
  error?: string
  onInstallMiKTeX: () => void
  onCancelInstall: () => void
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

function Checkmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LACompileStatus({
  status,
  progress,
  error,
  onInstallMiKTeX,
  onCancelInstall,
}: LACompileStatusProps) {
  const { t } = useTranslation()

  // idle — render nothing
  if (status === 'idle') return null

  return (
    <>
      {/* MiKTeX absent — Dialog prompt */}
      <Dialog open={status === 'miktex-absent'}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('tugas:la.miktex.absent')}</DialogTitle>
            <DialogDescription>{t('tugas:la.miktex.installPrompt')}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={onCancelInstall}>
              {t('tugas:la.miktex.cancel')}
            </Button>
            <Button onClick={onInstallMiKTeX}>{t('tugas:la.miktex.install')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All other status — inline banner */}
      {status !== 'miktex-absent' && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex flex-col gap-2 rounded-md border px-4 py-3 text-sm',
            status === 'done' &&
              'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
            status === 'error' &&
              'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
            (status === 'checking' || status === 'compiling') &&
              'border-border bg-muted/50 text-muted-foreground',
            status === 'installing' &&
              'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
          )}
        >
          {/* Row: icon + label */}
          <div className="flex items-center gap-2">
            {(status === 'checking' || status === 'compiling') && (
              <Spinner className="h-4 w-4 shrink-0" />
            )}
            {status === 'installing' && (
              <Spinner className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            )}
            {status === 'done' && (
              <Checkmark className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
            )}
            {status === 'error' && (
              <span className="shrink-0 font-bold" aria-hidden="true">
                ✕
              </span>
            )}

            <span className="font-medium">
              {status === 'checking' && t('tugas:la.compile.checking')}
              {status === 'installing' && t('tugas:la.miktex.installing')}
              {status === 'compiling' && t('tugas:la.preview.compiling')}
              {status === 'done' && t('tugas:la.status.done')}
              {status === 'error' && t('tugas:la.status.error')}
            </span>
          </div>

          {/* Installing — progress bar */}
          {status === 'installing' && (
            <Progress
              value={progress}
              className="h-1.5"
              aria-label={t('tugas:la.miktex.installing')}
            />
          )}

          {/* Error — message detail */}
          {status === 'error' && error && (
            <p className="font-mono text-xs break-all opacity-80">{error}</p>
          )}
        </div>
      )}
    </>
  )
}
