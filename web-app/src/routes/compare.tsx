/**
 * Compare feature — multi-model side-by-side chat route.
 *
 * v1 EXCLUSIONS (DO NOT add without an explicit plan revision):
 *   - NO persistence (memory-only Zustand store)
 *   - NO per-column system prompt or parameters
 *   - NO voting / winner / rating / diff view
 *   - NO "save as thread" / continuation to /threads
 *   - NO regenerate-response button
 *   - NO export formats other than Markdown
 *   - NO page-level scroll (column-internal scroll only)
 *   - NO sync-scroll across columns
 *   - NO automatic retries on stream failure
 *   - NO column add/remove framer-motion animations under prefers-reduced-motion: reduce
 *   - NO modifications to: custom-chat-transport.ts, mcp-orchestrator/**, model-factory.ts,
 *     chat-session-store.ts, useModelProvider.ts, use-chat.ts
 */

import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCompareSession } from '@/hooks/useCompareSession'
import { CompareHeader } from '@/components/compare/CompareHeader'
import ModelMultiSelector from '@/components/compare/ModelMultiSelector'
import { MasterPromptInput } from '@/components/compare/MasterPromptInput'
import { CompareGrid } from '@/components/compare/CompareGrid'
import { CompareColumn } from '@/components/compare/CompareColumn'
import AttachmentIngestionDialog from '@/containers/dialogs/AttachmentIngestionDialog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.compare as any)({
  component: ComparePage,
})

export function ComparePage() {
  const { t } = useTranslation('compare')
  const {
    columns,
    masterPrompt,
    isAnyStreaming,
    canSend,
    setMasterPrompt,
    addModel,
    removeModel,
    sendToAll,
    stopColumn,
    stopAll,
    clearAll,
  } = useCompareSession()

  // T16 a11y: focus restoration after Send All
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // T16 a11y: global polite announcement region for column status transitions
  const [announcement, setAnnouncement] = useState('')
  const prevStatusesRef = useRef<Record<string, string>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    const msgs: string[] = []
    for (const col of columns) {
      const prev = prevStatusesRef.current[col.id]
      next[col.id] = col.status
      if (prev !== col.status) {
        if (col.status === 'streaming') {
          msgs.push(t('ariaLiveStreaming', { model: col.modelId }))
        } else if (col.status === 'finished' && prev === 'streaming') {
          msgs.push(t('ariaLiveDone', { model: col.modelId }))
        }
      }
    }
    prevStatusesRef.current = next
    if (msgs.length > 0) {
      setAnnouncement(msgs.join('. '))
    }
  }, [columns, t])

  // Derived flags
  const canClear = columns.length > 0

  // Selected models projection for ModelMultiSelector
  const selectedModels = useMemo(
    () =>
      columns.map((c) => ({
        providerId: c.provider.provider,
        modelId: c.modelId,
      })),
    [columns]
  )

  // Handlers
  const handleSendAll = useCallback(() => {
    sendToAll(masterPrompt)
    // Clear the master prompt textarea after dispatch so the user can
    // immediately type the next prompt without manually deleting the
    // previous one. Matches /threads ChatInput's post-send clear behavior.
    setMasterPrompt('')
    // T16 a11y: keep focus on the master prompt so users can keep composing
    // without re-tabbing through the column tree.
    requestAnimationFrame(() => promptRef.current?.focus())
  }, [sendToAll, masterPrompt, setMasterPrompt])

  const handleRemoveModel = useCallback(
    (providerId: string, modelId: string) => {
      const col = columns.find(
        (c) => c.provider.provider === providerId && c.modelId === modelId
      )
      if (col && col.messages.length > 0) {
        // Native confirm for v1; can swap to AlertDialog later without changing the call shape.
        const ok = window.confirm(t('removeColumnConfirm'))
        if (!ok) return
      }
      removeModel(providerId, modelId)
    },
    [columns, removeModel, t]
  )

  return (
    <div className="flex flex-col h-svh overflow-hidden bg-background">
      {/* T16 a11y: single global polite live region for column status transitions */}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="compare-aria-live"
      >
        {announcement}
      </div>

      <div className="flex-shrink-0">
        <CompareHeader
          canClear={canClear}
          isAnyStreaming={isAnyStreaming}
          onClearAll={clearAll}
        />
      </div>

      <div className="flex-shrink-0 px-4 py-2 border-b">
        <ModelMultiSelector
          selectedModels={selectedModels}
          onAdd={addModel}
          onRemove={handleRemoveModel}
          disabled={isAnyStreaming}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {columns.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {t('minModelsHint')}
          </div>
        ) : (
          <CompareGrid>
            {columns.map((col) => (
              <CompareColumn
                key={col.id}
                column={col}
                onStop={() => stopColumn(col.id)}
                onRemove={() =>
                  handleRemoveModel(col.provider.provider, col.modelId)
                }
              />
            ))}
          </CompareGrid>
        )}
      </div>

      <div className="flex-shrink-0">
        <MasterPromptInput
          value={masterPrompt}
          onChange={setMasterPrompt}
          onSendAll={handleSendAll}
          onStopAll={stopAll}
          canSend={canSend}
          isAnyStreaming={isAnyStreaming}
          inputRef={promptRef}
        />
      </div>

      {/*
        AttachmentIngestionDialog is a global modal driven by its own Zustand
        store. Rendering it once here lets `processAttachmentsForSend` open
        the inline-vs-embeddings prompt for documents the same way /threads
        does — no Compare-specific dispatch wiring required.
      */}
      <AttachmentIngestionDialog />
    </div>
  )
}
