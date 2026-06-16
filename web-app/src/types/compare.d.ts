// Types for the ephemeral Compare feature. Memory-only, never persisted.

import type { UIMessage } from '@ai-sdk/react'

export type CompareColumnStatus =
  | 'idle'
  | 'streaming'
  | 'stopping'
  | 'finished'
  | 'error'

export type CompareColumnMetrics = {
  ttftMs: number | null
  totalMs: number | null
  outputTokens: number | null
}

export type CompareColumn = {
  id: string
  sessionId: string
  provider: ModelProvider
  modelId: string
  status: CompareColumnStatus
  messages: UIMessage[]
  metrics: CompareColumnMetrics
  error: string | null
  sendStartedAt: number | null
}

export type CompareSessionState = {
  columns: CompareColumn[]
  masterPrompt: string
}

export type CompareExportData = {
  generatedAt: string
  masterPrompt: string
  columns: Array<{
    provider: string
    modelId: string
    metrics: CompareColumnMetrics
    messages: UIMessage[]
  }>
}
