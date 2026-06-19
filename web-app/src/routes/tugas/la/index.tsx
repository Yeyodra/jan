import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { route } from '@/constants/routes'
import { useLAGenerator } from '@/hooks/tugas/useLAGenerator'
import { usePdfCompile } from '@/hooks/tugas/usePdfCompile'
import { useChatSessions } from '@/stores/chat-session-store'
import { LAForm } from '@/components/tugas/la/LAForm'
import { LAEditor } from '@/components/tugas/la/LAEditor'
import { LAPreview } from '@/components/tugas/la/LAPreview'
import { LACompileStatus } from '@/components/tugas/la/LACompileStatus'
import { TugasHeader } from '@/components/tugas/shared/TugasHeader'
import type { LAFormData } from '@/types/tugas'

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute(route.tugas.la as any)({
  component: LAGenerator,
})

// ─── State machine ────────────────────────────────────────────────────────────

type PageState = 'idle' | 'generating' | 'tex-ready' | 'compiled'

// ─── LaTeX extraction ─────────────────────────────────────────────────────────

/**
 * Extract LaTeX source from an LLM message string.
 * Accepts ```latex ... ``` fenced blocks, or bare \documentclass … \end{document}.
 */
function extractLatex(text: string): string | null {
  // Fenced code block: ```latex ... ``` or ```tex ... ```
  const fenced = text.match(/```(?:latex|tex)\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()

  // Bare \documentclass ... \end{document}
  const bare = text.match(/(\\documentclass[\s\S]*?\\end\{document\})/)
  if (bare) return bare[1].trim()

  return null
}

/**
 * Get the combined text content of all assistant messages in a session.
 * UIMessage uses `parts` (not `content`) — each part has a `type` field.
 * TextUIPart shape: { type: 'text'; text: string }
 */
function getAssistantText(sessionId: string): string {
  const session = useChatSessions.getState().sessions[sessionId]
  if (!session) return ''

  return session.data.messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) =>
      m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
    )
    .join('\n')
}

// ─── Component ────────────────────────────────────────────────────────────────

function LAGenerator() {
  const { t } = useTranslation()

  // ── Generator hook (creates thread, navigates) ──────────────────────────────
  const generator = useLAGenerator()

  // ── Compiler hook ───────────────────────────────────────────────────────────
  const compiler = usePdfCompile()

  // ── Page state machine ──────────────────────────────────────────────────────
  const [pageState, setPageState] = useState<PageState>('idle')

  // ── Derived paths from generator ────────────────────────────────────────────
  const texFilePath =
    generator.outputFolder ? `${generator.outputFolder}/main.tex` : ''

  // ── Extracted LaTeX content ─────────────────────────────────────────────────
  const [texContent, setTexContent] = useState('')

  // ── Navigate-away guard while generating ───────────────────────────────────
  useEffect(() => {
    if (pageState !== 'generating') return

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = t('tugas:la.guard.generating')
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pageState, t])

  // ── Sync generator status → page state ─────────────────────────────────────
  useEffect(() => {
    if (generator.status === 'generating' && pageState === 'idle') {
      setPageState('generating')
    }
  }, [generator.status, pageState])

  // ── Poll thread messages for LaTeX content ──────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Only poll when we have a threadId and are in generating state
    if (generator.status !== 'generating' || !generator.threadId || !generator.outputFolder) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    const threadId = generator.threadId
    const outputFolder = generator.outputFolder

    const checkMessages = async () => {
      const text = getAssistantText(threadId)
      if (!text) return

      const latex = extractLatex(text)
      if (!latex) return

      // Found LaTeX — stop polling
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }

      // Save to main.tex
      const filePath = `${outputFolder}/main.tex`
      try {
        await invoke('write_text_file', { path: filePath, content: latex })
        setTexContent(latex)
        setPageState('tex-ready')
      } catch (err) {
        console.error('[LAGenerator] Failed to write main.tex:', err)
      }
    }

    pollRef.current = setInterval(checkMessages, 2000)

    // Also run immediately
    checkMessages()

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [generator.status, generator.threadId, generator.outputFolder])

  // ── Sync compile status → page state ───────────────────────────────────────
  useEffect(() => {
    if (compiler.status === 'done' && pageState === 'tex-ready') {
      setPageState('compiled')
    }
  }, [compiler.status, pageState])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleGenerate = (data: LAFormData) => {
    // Reset compiler state on new generation
    compiler.reset()
    setTexContent('')
    setPageState('idle')
    generator.generate(data)
  }

  const handleCompile = async () => {
    if (!texFilePath) return
    const hasPdflatex = await compiler.checkPdflatex()
    if (hasPdflatex) {
      compiler.compile(texFilePath)
    }
    // If not found, usePdfCompile sets status to 'miktex-absent' automatically
  }

  const handleRecompile = async (content: string) => {
    if (!texFilePath) return
    try {
      await invoke('write_text_file', { path: texFilePath, content })
    } catch (err) {
      console.error('[LAGenerator] Failed to write before recompile:', err)
    }
    const hasPdflatex = await compiler.checkPdflatex()
    if (hasPdflatex) {
      compiler.compile(texFilePath)
    }
  }

  const handleInstallMiKTeX = () => {
    compiler.installMiKTeX()
  }

  const handleCancelInstall = () => {
    compiler.reset()
  }

  // ── Layout ───────────────────────────────────────────────────────────────────

  const showRightPanel = pageState === 'tex-ready' || pageState === 'compiled'
  const isGenerating = pageState === 'generating'

  return (
    <div className="flex flex-col h-full">
      {/* Header with breadcrumb */}
      <TugasHeader pageTitle={t('tugas:la.title')} />

      {/* Main content */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* ── Left panel ──────────────────────────────────────────────────────── */}
        <div
          className={
            showRightPanel
              ? 'w-1/2 flex flex-col border-r border-border overflow-y-auto p-6'
              : 'flex-1 flex flex-col overflow-y-auto p-6'
          }
        >
          {/* Generator error banner */}
          {generator.status === 'error' && generator.error && (
            <div
              className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive"
              role="alert"
            >
              {generator.error}
            </div>
          )}

          {/* Generating indicator */}
          {isGenerating && (
            <div
              className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2"
              aria-live="polite"
            >
              <svg
                className="animate-spin size-4 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {t('tugas:la.status.generating')}
            </div>
          )}

          {/* Form — always visible, disabled while generating */}
          {!showRightPanel && (
            <div className={isGenerating ? 'pointer-events-none opacity-60' : ''}>
              <LAForm onGenerate={handleGenerate} />
            </div>
          )}

          {/* Editor — shown after tex-ready */}
          {showRightPanel && (
            <LAEditor
              texFilePath={texFilePath}
              initialContent={texContent}
              onRecompile={handleRecompile}
            />
          )}
        </div>

        {/* ── Right panel (only when tex-ready or compiled) ────────────────────── */}
        {showRightPanel && (
          <div className="w-1/2 flex flex-col overflow-y-auto p-6 gap-4">
            {/* Preview + Compile button */}
            <LAPreview
              texFilePath={texFilePath}
              status={compiler.status}
              outputPdfPath={compiler.outputPdfPath}
              onCompile={handleCompile}
            />

            {/* Compile status (hidden when idle) */}
            <LACompileStatus
              status={compiler.status}
              progress={compiler.progress}
              error={compiler.error}
              onInstallMiKTeX={handleInstallMiKTeX}
              onCancelInstall={handleCancelInstall}
            />
          </div>
        )}
      </div>
    </div>
  )
}
