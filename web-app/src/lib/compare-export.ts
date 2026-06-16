/**
 * Compare feature — Markdown export utility.
 *
 * Provides three pure-ish helpers:
 *   - buildCompareFilename(now?)  → deterministic filename
 *   - buildCompareMarkdown(data)  → deterministic markdown body
 *   - exportCompareToFile(data)   → side-effecting save flow
 *
 * Tauri filesystem access is intentionally routed through the service-hub
 * (`useServiceHub().dialog().save()` + `useServiceHub().core().invoke('write_file_sync', …)`)
 * — the helper MUST NOT import from `@tauri-apps/plugin-*` directly.
 *
 * In non-Tauri runtimes (e.g. `bun dev` web build, where `DefaultDialogService`
 * is a no-op stub), the helper falls back to a Blob + anchor download.
 */

import type { UIMessage } from '@ai-sdk/react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform/utils'
import type { CompareColumnMetrics, CompareExportData } from '@/types/compare'

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

export function buildCompareFilename(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const y = now.getFullYear()
  const M = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const m = pad(now.getMinutes())
  return `jan-compare-${y}-${M}-${d}-${h}${m}.md`
}

// ---------------------------------------------------------------------------
// Sanitization (defense-in-depth secret scrubbing)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[a-zA-Z0-9_-]{20,}/g, '[redacted]'],
  [/Bearer\s+[A-Za-z0-9._-]+/g, '[redacted]'],
  [/api[-_]?key["'\s:=]+[A-Za-z0-9_-]{16,}/gi, '[redacted]'],
]

function sanitize(text: string): string {
  let out = text
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement)
  }
  return out
}

// ---------------------------------------------------------------------------
// Message → markdown
// ---------------------------------------------------------------------------

type MessageLike = Pick<UIMessage, 'role' | 'parts'> & {
  // UIMessage in newer @ai-sdk/react versions exposes `parts`; older shapes
  // sometimes carry `content` instead. Accept both defensively.
  content?: string
}

function extractText(message: MessageLike): { text: string; hadNonText: boolean } {
  const parts = message.parts as Array<{ type: string; text?: string }> | undefined
  if (Array.isArray(parts) && parts.length > 0) {
    const textChunks: string[] = []
    let hadNonText = false
    for (const part of parts) {
      if (part && part.type === 'text' && typeof part.text === 'string') {
        textChunks.push(part.text)
      } else {
        hadNonText = true
      }
    }
    return { text: textChunks.join(''), hadNonText }
  }
  // Legacy shape — flat string content.
  if (typeof message.content === 'string') {
    return { text: message.content, hadNonText: false }
  }
  return { text: '', hadNonText: false }
}

function renderMessage(message: MessageLike): string {
  const role =
    message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System'
  const { text, hadNonText } = extractText(message)
  const cleaned = sanitize(text).trim()
  if (cleaned.length === 0 && hadNonText) {
    return `**${role}:** _(non-text content omitted)_`
  }
  if (cleaned.length === 0) {
    return `**${role}:**`
  }
  if (hadNonText) {
    return `**${role}:** ${cleaned}\n\n_(non-text content omitted)_`
  }
  return `**${role}:** ${cleaned}`
}

// ---------------------------------------------------------------------------
// Metrics & column rendering
// ---------------------------------------------------------------------------

function fmtMetric(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value)
}

function renderMetricsTable(metrics: CompareColumnMetrics): string {
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| TTFT | ${fmtMetric(metrics.ttftMs)} ms |`,
    `| Total time | ${fmtMetric(metrics.totalMs)} ms |`,
    `| Output tokens | ${fmtMetric(metrics.outputTokens)} |`,
  ].join('\n')
}

function renderColumn(
  index: number,
  column: CompareExportData['columns'][number]
): string {
  const lines: string[] = []
  lines.push(`## Column ${index + 1} — ${column.provider} / ${column.modelId}`)
  lines.push('')
  lines.push(renderMetricsTable(column.metrics))
  lines.push('')
  lines.push('### Conversation')
  lines.push('')
  if (!column.messages || column.messages.length === 0) {
    lines.push('_(no messages)_')
  } else {
    const rendered = column.messages.map(renderMessage)
    lines.push(rendered.join('\n\n'))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Master prompt rendering
// ---------------------------------------------------------------------------

function renderMasterPrompt(prompt: string): string {
  const trimmed = prompt ?? ''
  if (trimmed.length === 0) {
    return '_(empty prompt)_'
  }
  // Multi-line → fenced code block; single-line → paragraph.
  if (trimmed.includes('\n')) {
    return ['```text', trimmed, '```'].join('\n')
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Public: buildCompareMarkdown
// ---------------------------------------------------------------------------

export function buildCompareMarkdown(data: CompareExportData): string {
  const sections: string[] = []
  sections.push(`# Jan Compare — ${data.generatedAt}`)
  sections.push('')
  sections.push('## Master Prompt')
  sections.push('')
  sections.push(renderMasterPrompt(data.masterPrompt))
  sections.push('')

  if (!data.columns || data.columns.length === 0) {
    sections.push('_No columns to export._')
    return sections.join('\n')
  }

  for (let i = 0; i < data.columns.length; i++) {
    sections.push(renderColumn(i, data.columns[i]))
    if (i < data.columns.length - 1) {
      sections.push('')
      sections.push('---')
      sections.push('')
    }
  }

  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// Public: exportCompareToFile
// ---------------------------------------------------------------------------

export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'no-tauri' | 'error'; message?: string }

function blobDownload(filename: string, markdown: string): ExportResult {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return {
      ok: false,
      reason: 'no-tauri',
      message: 'No browser environment available for blob fallback.',
    }
  }
  try {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    // Some browsers require the anchor to be in the DOM before .click().
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return { ok: true, path: filename }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function exportCompareToFile(
  data: CompareExportData
): Promise<ExportResult> {
  const filename = buildCompareFilename()
  const markdown = buildCompareMarkdown(data)

  // Non-Tauri runtime → straight to blob fallback. The DefaultDialogService is a
  // no-op stub that returns null instantly, which is indistinguishable from a
  // real user cancellation, so we short-circuit on the platform check.
  if (!isPlatformTauri()) {
    return blobDownload(filename, markdown)
  }

  try {
    const hub = getServiceHub()
    const path = await hub.dialog().save({
      defaultPath: filename,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })

    if (path === null || path === undefined) {
      return { ok: false, reason: 'cancelled' }
    }

    try {
      await hub.core().invoke<void>('write_file_sync', { args: [path, markdown] })
      return { ok: true, path }
    } catch (writeErr) {
      return {
        ok: false,
        reason: 'error',
        message:
          writeErr instanceof Error ? writeErr.message : String(writeErr),
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
