import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_SAVE_DEBOUNCE_MS = 1000

// ─── Props ────────────────────────────────────────────────────────────────────

interface LAEditorProps {
  texFilePath: string
  initialContent: string
  onRecompile: (content: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LAEditor({ texFilePath, initialContent, onRecompile }: LAEditorProps) {
  const { t } = useTranslation()

  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Debounce timer ref so we can clear it on each keystroke
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When initialContent changes externally (e.g., after new LLM generation),
  // reset the editor content.
  useEffect(() => {
    setContent(initialContent)
  }, [initialContent])

  // Auto-save: write to file 1000ms after the user stops typing
  useEffect(() => {
    if (!texFilePath) return

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setIsSaving(true)
      setSaveError(null)
      try {
        await invoke('write_text_file', { path: texFilePath, content })
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsSaving(false)
      }
    }, AUTO_SAVE_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [content, texFilePath])

  const handleRecompile = () => {
    onRecompile(content)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <Label asChild>
          <h3 className="text-sm font-medium text-foreground">
            {t('tugas:la.editor.title')}
          </h3>
        </Label>

        <div className="flex items-center gap-2">
          {/* Save indicator */}
          {isSaving && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t('tugas:la.editor.saving')}
            </span>
          )}
          {saveError && (
            <span className="text-xs text-red-600 dark:text-red-400" aria-live="assertive">
              {t('tugas:la.editor.saveError')}
            </span>
          )}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!texFilePath}
            onClick={handleRecompile}
          >
            {t('tugas:la.editor.save')}
          </Button>
        </div>
      </div>

      {/* Raw LaTeX textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={!texFilePath}
        spellCheck={false}
        aria-label={t('tugas:la.editor.title')}
        className={cn(
          // Sizing
          'min-h-[420px] w-full resize-y',
          // Font — monospace for LaTeX
          'font-mono text-xs leading-relaxed',
          // Box model
          'rounded-md border px-3 py-2.5',
          // Colors — dark mode aware
          'border-input bg-background text-foreground',
          'dark:bg-input/30',
          // Focus ring (matches Input/Textarea in LAForm)
          'shadow-xs outline-none transition-[color,box-shadow]',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          // Disabled
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
          // Scrollbar stays visible for long LaTeX docs
          'overflow-y-auto',
        )}
      />

      {/* File path hint */}
      {texFilePath && (
        <p
          className="truncate text-xs text-muted-foreground"
          title={texFilePath}
          aria-label={t('tugas:la.editor.filePath')}
        >
          {texFilePath}
        </p>
      )}
    </div>
  )
}
