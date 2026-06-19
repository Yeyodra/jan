import { useTranslation } from '@/i18n/react-i18next-compat'
import type { CompileStatus } from '@/types/tugas'
import { Button } from '@/components/ui/button'
import { LACompileStatus } from './LACompileStatus'
import { cn } from '@/lib/utils'

// ─── Props ────────────────────────────────────────────────────────────────────

interface LAPreviewProps {
  texFilePath: string
  status: CompileStatus
  outputPdfPath?: string
  onCompile: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract just the filename from an absolute path (cross-platform). */
function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LAPreview({
  texFilePath,
  status,
  outputPdfPath,
  onCompile,
}: LAPreviewProps) {
  const { t } = useTranslation()

  const isCompiling = status === 'compiling' || status === 'checking' || status === 'installing'
  const isDone = status === 'done' && !!outputPdfPath

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {t('tugas:la.preview.title')}
        </h3>
        {!isDone && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isCompiling || !texFilePath}
            onClick={onCompile}
          >
            {isCompiling
              ? t('tugas:la.preview.compiling')
              : t('tugas:la.preview.compile')}
          </Button>
        )}
      </div>

      {/* Preview frame */}
      <div
        className={cn(
          'relative flex items-center justify-center overflow-hidden rounded-md border',
          'bg-muted/30 min-h-[420px] w-full',
        )}
      >
        {isDone ? (
          /* PDF viewer — native iframe */
          <iframe
            src={`file://${outputPdfPath}`}
            title={t('tugas:la.preview.title')}
            className="h-full w-full min-h-[420px] border-0"
            aria-label={t('tugas:la.preview.title')}
          />
        ) : (
          /* Placeholder — LaTeX file card */
          <button
            type="button"
            disabled={isCompiling || !texFilePath}
            onClick={onCompile}
            className={cn(
              'flex flex-col items-center gap-3 rounded-lg px-8 py-10',
              'text-muted-foreground transition-colors',
              !isCompiling && texFilePath
                ? 'hover:text-foreground cursor-pointer hover:bg-muted/60'
                : 'cursor-default opacity-60',
            )}
            aria-label={
              texFilePath
                ? t('tugas:la.preview.compile')
                : t('tugas:la.preview.noPreview')
            }
          >
            {/* LaTeX file icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-14 w-14 opacity-50"
              aria-hidden="true"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="13" x2="15" y2="13" />
              <line x1="9" y1="17" x2="13" y2="17" />
              <line x1="9" y1="9" x2="10" y2="9" />
            </svg>

            <span className="text-center text-sm">
              {texFilePath ? (
                <>
                  <span className="block font-mono text-xs opacity-70">
                    {basename(texFilePath)}
                  </span>
                  <span className="mt-1 block">
                    {t('tugas:la.preview.compile')}
                  </span>
                </>
              ) : (
                t('tugas:la.preview.noPreview')
              )}
            </span>
          </button>
        )}

        {/* Compile status overlay (while compiling) */}
        {isCompiling && (
          <div className="absolute inset-x-0 bottom-0 p-3">
            <LACompileStatus
              status={status}
              progress={0}
              onInstallMiKTeX={() => {}}
              onCancelInstall={() => {}}
            />
          </div>
        )}
      </div>

      {/* Open PDF button after done */}
      {isDone && outputPdfPath && (
        <p className="text-xs text-muted-foreground truncate" title={outputPdfPath}>
          {outputPdfPath}
        </p>
      )}
    </div>
  )
}
