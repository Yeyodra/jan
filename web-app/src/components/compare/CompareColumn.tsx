import { useEffect, useRef, useState } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { CopyButton } from '@/containers/CopyButton'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  IconAlertTriangle,
  IconFile,
  IconLoader2,
  IconPhoto,
  IconPlayerStopFilled,
  IconVolume,
  IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import type { CompareColumn as CompareColumnType } from '@/types/compare'

// Shape of a `file`-typed UIMessage part. AI SDK keeps its own per-version
// types so we narrow on the runtime shape rather than importing.
type FilePart = { type: 'file'; mediaType?: string; url?: string }
type TextPart = { type: 'text'; text?: string }

export interface CompareColumnProps {
  column: CompareColumnType
  onStop: () => void
  onRemove: () => void
}

export function CompareColumn({ column, onStop, onRemove }: CompareColumnProps) {
  return (
    <div
      className={cn(
        'flex flex-col h-full overflow-hidden min-h-0 min-w-0',
        'rounded-lg border bg-card text-card-foreground shadow-sm',
        'motion-safe:transition-[opacity,transform] motion-safe:duration-200'
      )}
    >
      <ColumnHeader column={column} onStop={onStop} onRemove={onRemove} />
      <ColumnContent column={column} />
    </div>
  )
}

function ColumnHeader({ column, onStop, onRemove }: CompareColumnProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
      <ProvidersAvatar provider={column.provider} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={column.modelId}>
          {column.modelId}
        </div>
      </div>
      <ColumnStatusBadge column={column} onStop={onStop} />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('compare:removeColumn')}
        className="rounded p-1 hover:bg-foreground/10 motion-safe:transition-colors"
      >
        <IconX size={14} />
      </button>
    </div>
  )
}

function ColumnStatusBadge({
  column,
  onStop,
}: {
  column: CompareColumnType
  onStop: () => void
}) {
  const { t } = useTranslation()

  if (column.status === 'streaming') {
    return (
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center gap-1"
      >
        <IconLoader2
          size={12}
          className="animate-spin text-muted-foreground"
          aria-hidden
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onStop}
          aria-label={t('compare:stopColumn')}
          className="h-7 px-2"
        >
          <IconPlayerStopFilled size={12} className="mr-1" />
          {t('compare:stopColumn')}
        </Button>
      </div>
    )
  }

  if (column.status === 'stopping') {
    return (
      <span
        aria-live="polite"
        aria-atomic="true"
        className="text-xs text-muted-foreground"
      >
        {t('common:stopping', { defaultValue: 'Stopping…' })}
      </span>
    )
  }

  if (column.status === 'error') {
    const errorText = column.error ?? ''
    return (
      <span
        aria-live="polite"
        aria-atomic="true"
        role="alert"
        className="flex items-center gap-1 text-xs text-destructive max-w-[12rem]"
      >
        <IconAlertTriangle size={12} className="shrink-0" aria-hidden />
        <span className="truncate" title={errorText}>
          {t('compare:errorPrefix')}
          {errorText}
        </span>
      </span>
    )
  }

  return null
}

function ColumnContent({ column }: { column: CompareColumnType }) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages update or stream advances.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [column.messages, column.status])

  if (column.messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        aria-live="off"
        className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-3"
      >
        {t('compare:emptyColumn')}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      aria-live="off"
      className="flex-1 overflow-y-auto p-3 space-y-3"
    >
      {column.messages.map((message, idx) => (
        <MessageBubble
          key={message.id ?? `msg-${idx}`}
          message={message}
        />
      ))}
    </div>
  )
}

function extractText(message: UIMessage): string {
  const parts = (message.parts ?? []) as Array<TextPart | FilePart>
  let text = ''
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      text += part.text
    }
  }
  return text
}

function extractFileParts(message: UIMessage): FilePart[] {
  const parts = (message.parts ?? []) as Array<TextPart | FilePart>
  const files: FilePart[] = []
  for (const part of parts) {
    if (
      part.type === 'file' &&
      typeof part.url === 'string' &&
      part.url.length > 0
    ) {
      files.push(part)
    }
  }
  return files
}

function inferAttachmentName(part: FilePart, idx: number): string {
  const mt = part.mediaType ?? ''
  if (mt.startsWith('image/')) return `image-${idx + 1}`
  if (mt.startsWith('audio/')) return `audio-${idx + 1}`
  return `file-${idx + 1}`
}

function MessageBubble({ message }: { message: UIMessage }) {
  const text = extractText(message)
  const files = extractFileParts(message)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const previewing = previewIdx != null ? files[previewIdx] : null

  if (message.role === 'user') {
    return (
      <>
        {/*
          Right-aligned, capped width so the user prompt visually peels off
          from the assistant bubble below. ml-auto + max-w guarantees there
          is always whitespace on the LEFT — which is the cue users read as
          "this came from me, not the model".
        */}
        <div
          data-testid="compare-user-bubble"
          className="ml-auto max-w-[85%] rounded-md bg-muted/60 px-3 py-2 text-sm"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide opacity-60 mb-1">
            User
          </div>
          {text.length > 0 && (
            <div className="whitespace-pre-wrap break-words">{text}</div>
          )}
          {files.length > 0 && (
            <div
              className={cn(
                'flex flex-wrap gap-1.5',
                text.length > 0 ? 'mt-2' : ''
              )}
              data-testid="compare-user-attachments"
            >
              {files.map((part, idx) => (
                <AttachmentChip
                  key={`${message.id ?? 'msg'}-att-${idx}`}
                  part={part}
                  name={inferAttachmentName(part, idx)}
                  onClick={() => setPreviewIdx(idx)}
                />
              ))}
            </div>
          )}
        </div>
        <AttachmentPreviewDialog
          open={previewing != null}
          onOpenChange={(open) => !open && setPreviewIdx(null)}
          part={previewing}
          name={
            previewing
              ? inferAttachmentName(previewing, previewIdx ?? 0)
              : ''
          }
        />
      </>
    )
  }

  // Assistant (default). `mt-1` after a user bubble buys a hair of whitespace
  // so consecutive turns are visually distinct without burning a full row.
  return (
    <div
      data-testid="compare-assistant-bubble"
      className="mt-1 rounded-md border px-3 py-2 text-sm group min-w-0"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide opacity-60">
          Assistant
        </span>
        {text.length > 0 && (
          <div className="opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">
            <CopyButton text={text} />
          </div>
        )}
      </div>
      {/*
        min-w-0 + overflow-x-auto prevents wide markdown content (long code
        blocks, tables, unbreakable URLs) from forcing the column wider than
        its grid cell, which would in turn defeat the parent's overflow chain.
      */}
      <div className="min-w-0 overflow-x-auto">
        {text.length > 0 ? (
          <RenderMarkdown content={text} />
        ) : (
          <div className="h-4" aria-hidden />
        )}
      </div>
    </div>
  )
}

function AttachmentChip({
  part,
  name,
  onClick,
}: {
  part: FilePart
  name: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  const mt = part.mediaType ?? ''
  const isImage = mt.startsWith('image/')
  const isAudio = mt.startsWith('audio/')

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${name} — ${t('compare:openPreview', {
        defaultValue: 'Open preview',
      })}`}
      aria-label={`${name} — ${t('compare:openPreview', {
        defaultValue: 'Open preview',
      })}`}
      className={cn(
        'flex items-center gap-1.5 rounded-md border bg-background',
        'px-2 py-1 text-xs',
        'hover:bg-foreground/5 motion-safe:transition-colors',
        'max-w-[12rem]'
      )}
    >
      {isImage && part.url ? (
        <img
          src={part.url}
          alt=""
          className="size-5 rounded object-cover shrink-0"
        />
      ) : isImage ? (
        <IconPhoto size={14} className="shrink-0 text-muted-foreground" />
      ) : isAudio ? (
        <IconVolume size={14} className="shrink-0 text-muted-foreground" />
      ) : (
        <IconFile size={14} className="shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{name}</span>
    </button>
  )
}

function AttachmentPreviewDialog({
  open,
  onOpenChange,
  part,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  part: FilePart | null
  name: string
}) {
  if (!part) return null
  const mt = part.mediaType ?? ''
  const isImage = mt.startsWith('image/')
  const isAudio = mt.startsWith('audio/')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center max-h-[70vh] overflow-auto">
          {isImage && part.url ? (
            <img
              src={part.url}
              alt={name}
              className="max-w-full max-h-[60vh] object-contain rounded-md"
            />
          ) : isAudio && part.url ? (
            <audio
              controls
              src={part.url}
              className="w-full"
              data-testid="compare-attachment-audio"
            />
          ) : (
            <div className="text-sm text-muted-foreground p-4">
              {mt || 'application/octet-stream'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CompareColumn
