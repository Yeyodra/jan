/**
 * Master prompt input for /compare. Wraps a textarea with:
 *   - attachment tray (chips above the input, with X-to-remove)
 *   - file pickers for images, audio, and documents
 *   - drag-and-drop + clipboard paste handlers (image / audio only)
 *   - Send All / Stop All button
 *
 * Attachments live in the shared `useChatAttachments` store keyed by
 * `COMPARE_MASTER_ATTACHMENT_KEY` so the same infrastructure /threads uses
 * (validation, deduplication, ingestion) is reused without modification.
 *
 * NO capability gating. Compare deliberately exposes every picker on every
 * session — the transport's `modelHasVision` strip handles text-only models
 * gracefully, and users keep explicit control via the per-model "Edit Model"
 * dialog.
 */
import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { toast } from 'sonner'
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  IconFile,
  IconPhoto,
  IconVolume,
} from '@tabler/icons-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { COMPARE_MASTER_ATTACHMENT_KEY } from '@/stores/compare-session-store'
import {
  createAudioAttachment,
  createDocumentAttachment,
  createImageAttachment,
  type Attachment,
} from '@/types/attachment'
import { getServiceHub } from '@/hooks/useServiceHub'

export interface MasterPromptInputProps {
  value: string
  onChange: (text: string) => void
  onSendAll: () => void
  onStopAll: () => void
  canSend: boolean
  isAnyStreaming: boolean
  /**
   * Optional ref forwarded to the underlying <textarea> element.
   * Used by the parent route to restore focus after Send All (T16 a11y).
   */
  inputRef?: Ref<HTMLTextAreaElement>
}

const MAX_ROWS = 12
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpg', 'image/jpeg', 'image/png'])

/** File extensions accepted by the document picker, mirroring /threads. */
const DOCUMENT_EXTENSIONS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'markdown',
  'csv',
  'xlsx',
  'xls',
  'ods',
  'pptx',
  'html',
  'htm',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'jsx',
  'tsx',
  'py',
  'pyw',
  'pyi',
  'rs',
  'go',
  'java',
  'kt',
  'kts',
  'rb',
  'php',
  'lua',
  'swift',
  'c',
  'h',
  'cpp',
  'cc',
  'cxx',
  'hpp',
  'hh',
]

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

function detectAudioFormat(file: File): 'wav' | 'mp3' | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (
    file.type === 'audio/wav' ||
    file.type === 'audio/x-wav' ||
    ext === 'wav'
  ) {
    return 'wav'
  }
  if (
    file.type === 'audio/mpeg' ||
    file.type === 'audio/mp3' ||
    ext === 'mp3'
  ) {
    return 'mp3'
  }
  return null
}

export function MasterPromptInput({
  value,
  onChange,
  onSendAll,
  onStopAll,
  canSend,
  isAnyStreaming,
  inputRef,
}: MasterPromptInputProps) {
  const { t } = useTranslation('compare')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const attachments = useChatAttachments((s) =>
    s.getAttachments(COMPARE_MASTER_ATTACHMENT_KEY)
  )
  const setAttachments = useChatAttachments((s) => s.setAttachments)

  const [isDragOver, setIsDragOver] = useState(false)
  const [previewIdx, setPreviewIdx] = useState<number | null>(null)
  const previewing = previewIdx != null ? attachments[previewIdx] : null

  // Forward the internal textarea node to the optional external ref so the
  // parent can call .focus() after dispatching Send All.
  useImperativeHandle(
    inputRef,
    () => textareaRef.current as HTMLTextAreaElement,
    []
  )

  const appendAttachments = useCallback(
    (next: Attachment[]) => {
      if (next.length === 0) return
      setAttachments(COMPARE_MASTER_ATTACHMENT_KEY, (prev) => [...prev, ...next])
    },
    [setAttachments]
  )

  const removeAttachmentAt = useCallback(
    (idx: number) => {
      setAttachments(COMPARE_MASTER_ATTACHMENT_KEY, (prev) =>
        prev.filter((_, i) => i !== idx)
      )
    },
    [setAttachments]
  )

  const processImageFiles = useCallback(
    async (files: File[]) => {
      const accepted: Attachment[] = []
      const oversized: string[] = []
      const wrongType: string[] = []
      for (const file of files) {
        const type = file.type || ''
        if (!ALLOWED_IMAGE_TYPES.has(type)) {
          wrongType.push(file.name)
          continue
        }
        if (file.size > MAX_IMAGE_BYTES) {
          oversized.push(file.name)
          continue
        }
        try {
          const dataUrl = await readAsDataURL(file)
          const base64 = dataUrl.split(',')[1] ?? ''
          accepted.push(
            createImageAttachment({
              name: file.name,
              base64,
              dataUrl,
              mimeType: type,
              size: file.size,
            })
          )
        } catch (err) {
          console.error('image read failed', err)
        }
      }
      if (wrongType.length > 0) {
        toast.error(
          t('attachments.errorImageType', {
            defaultValue: 'Only PNG/JPEG images are accepted',
          })
        )
      }
      if (oversized.length > 0) {
        toast.error(
          t('attachments.errorImageSize', {
            defaultValue: 'Images must be 10MB or smaller',
          })
        )
      }
      if (accepted.length > 0) appendAttachments(accepted)
    },
    [appendAttachments, t]
  )

  const processAudioFiles = useCallback(
    async (files: File[]) => {
      const accepted: Attachment[] = []
      const invalid: string[] = []
      const oversized: string[] = []
      for (const file of files) {
        const fmt = detectAudioFormat(file)
        if (!fmt) {
          invalid.push(file.name)
          continue
        }
        if (file.size > MAX_AUDIO_BYTES) {
          oversized.push(file.name)
          continue
        }
        try {
          const dataUrl = await readAsDataURL(file)
          const base64 = dataUrl.split(',')[1] ?? ''
          const mimeType = fmt === 'wav' ? 'audio/wav' : 'audio/mpeg'
          accepted.push(
            createAudioAttachment({
              name: file.name,
              base64,
              dataUrl,
              mimeType,
              audioFormat: fmt,
              size: file.size,
            })
          )
        } catch (err) {
          console.error('audio read failed', err)
        }
      }
      if (invalid.length > 0) {
        toast.error(
          t('attachments.errorAudioType', {
            defaultValue: 'Only WAV/MP3 audio is accepted',
          })
        )
      }
      if (oversized.length > 0) {
        toast.error(
          t('attachments.errorAudioSize', {
            defaultValue: 'Audio must be 25MB or smaller',
          })
        )
      }
      if (accepted.length > 0) appendAttachments(accepted)
    },
    [appendAttachments, t]
  )

  const openImagePicker = useCallback(() => imageInputRef.current?.click(), [])
  const openAudioPicker = useCallback(() => audioInputRef.current?.click(), [])

  const openDocumentPicker = useCallback(async () => {
    // Tauri dialog → falls back gracefully when not in a desktop shell
    // (most likely in the browser-only test harness).
    let dialogService: ReturnType<ReturnType<typeof getServiceHub>['dialog']> | null = null
    try {
      dialogService = getServiceHub().dialog?.() ?? null
    } catch {
      dialogService = null
    }
    if (!dialogService || typeof dialogService.open !== 'function') {
      toast.info(
        t('attachments.docsUnavailable', {
          defaultValue: 'File picker is available in the desktop app only',
        })
      )
      return
    }

    try {
      const selection = await dialogService.open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Documents & Code',
            extensions: DOCUMENT_EXTENSIONS,
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      const created = paths
        .map((p) => (typeof p === 'string' ? p : null))
        .filter((p): p is string => !!p)
        .map((path) => {
          const fileName = path.split(/[\\/]/).pop() || path
          const ext = fileName.split('.').pop()?.toLowerCase()
          return createDocumentAttachment({
            name: fileName,
            path,
            fileType: ext,
            parseMode: 'auto',
          })
        })
      if (created.length > 0) appendAttachments(created)
    } catch (err) {
      console.error('document picker failed', err)
      toast.error(
        t('attachments.docsError', {
          defaultValue: 'Failed to open file picker',
        })
      )
    }
  }, [appendAttachments, t])

  const handleImageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = '' // allow same-file re-pick
      void processImageFiles(files)
    },
    [processImageFiles]
  )

  const handleAudioInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      e.target.value = ''
      void processAudioFiles(files)
    },
    [processAudioFiles]
  )

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])
  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      const images: File[] = []
      const audios: File[] = []
      for (const f of files) {
        if ((f.type || '').startsWith('image/')) images.push(f)
        else if ((f.type || '').startsWith('audio/')) audios.push(f)
      }
      if (images.length > 0) void processImageFiles(images)
      if (audios.length > 0) void processAudioFiles(audios)
    },
    [processImageFiles, processAudioFiles]
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      const images: File[] = []
      for (const f of files) {
        if ((f.type || '').startsWith('image/')) images.push(f)
      }
      if (images.length > 0) {
        e.preventDefault()
        void processImageFiles(images)
      }
    },
    [processImageFiles]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition guard (matches ChatInput pattern)
      const isComposing =
        e.nativeEvent.isComposing || e.keyCode === 229

      if (e.key === 'Escape') {
        if (isAnyStreaming) {
          e.preventDefault()
          onStopAll()
        }
        return
      }

      if (e.key === 'Enter' && !isComposing) {
        // Shift+Enter → newline (default browser behavior)
        if (e.shiftKey) return

        // Plain Enter or Cmd/Ctrl+Enter → submit (only when not streaming)
        e.preventDefault()
        if (!isAnyStreaming && canSend) {
          onSendAll()
        }
      }
    },
    [canSend, isAnyStreaming, onSendAll, onStopAll]
  )

  const chipIcon = useMemo<Record<Attachment['type'], LucideIcon | null>>(
    () => ({
      image: null, // image chip uses thumbnail
      audio: null,
      document: null,
    }),
    []
  )
  void chipIcon // future-proofing if we want to swap in non-Tabler icons

  return (
    <div
      data-testid="compare-master-input-root"
      data-drop-active={isDragOver ? 'true' : undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'border-t bg-background',
        isDragOver && 'ring-2 ring-primary/40'
      )}
    >
      {attachments.length > 0 && (
        <div
          data-testid="compare-master-attachments"
          className="flex flex-wrap gap-2 px-3 pt-3"
        >
          {attachments.map((att, idx) => (
            <MasterChip
              key={`${att.name}-${idx}`}
              attachment={att}
              onClick={() => setPreviewIdx(idx)}
              onRemove={() => removeAttachmentAt(idx)}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        {/* Hidden file inputs driven by dropdown menu items. */}
        <input
          ref={imageInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleImageInputChange}
          data-testid="compare-image-input"
        />
        <input
          ref={audioInputRef}
          type="file"
          multiple
          accept="audio/wav,audio/mpeg,audio/x-wav,.wav,.mp3"
          className="hidden"
          onChange={handleAudioInputChange}
          data-testid="compare-audio-input"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('attachments.menuLabel', {
                defaultValue: 'Add attachment',
              })}
              title={t('attachments.menuLabel', {
                defaultValue: 'Add attachment',
              })}
              data-testid="compare-attachment-menu"
            >
              <Paperclip className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={openImagePicker}
              data-testid="compare-attach-image"
            >
              <IconPhoto size={16} className="mr-2" />
              {t('attachments.addImage', { defaultValue: 'Add image' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={openAudioPicker}
              data-testid="compare-attach-audio"
            >
              <IconVolume size={16} className="mr-2" />
              {t('attachments.addAudio', { defaultValue: 'Add audio' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void openDocumentPicker()}
              data-testid="compare-attach-document"
            >
              <IconFile size={16} className="mr-2" />
              {t('attachments.addDocument', {
                defaultValue: 'Add document',
              })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <TextareaAutosize
          ref={textareaRef}
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('masterPromptPlaceholder')}
          minRows={2}
          maxRows={MAX_ROWS}
          aria-label={t('masterPrompt')}
          data-testid="compare-master-prompt"
          className={cn(
            'border-input placeholder:text-muted-foreground',
            'focus-visible:border-ring focus-visible:ring-ring/50',
            'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
            'dark:bg-input/30',
            'flex w-full flex-1 resize-none rounded-md border bg-transparent',
            'px-3 py-2 text-base shadow-xs outline-none',
            'transition-[color,box-shadow] focus-visible:ring-[3px]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'md:text-sm'
          )}
        />
        {isAnyStreaming ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            onClick={onStopAll}
            aria-label={t('stopAll')}
            title={t('stopAll')}
            data-testid="compare-stop-all"
          >
            <Square className="size-4" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="icon"
            onClick={onSendAll}
            disabled={!canSend}
            aria-label={t('sendAll')}
            title={t('sendAll')}
            data-testid="compare-send-all"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>

      <MasterAttachmentPreview
        open={previewing != null}
        onOpenChange={(open) => !open && setPreviewIdx(null)}
        attachment={previewing}
      />
    </div>
  )
}

function MasterChip({
  attachment,
  onClick,
  onRemove,
}: {
  attachment: Attachment
  onClick: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('compare')
  const isImage = attachment.type === 'image'
  const isAudio = attachment.type === 'audio'

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1.5 rounded-md border bg-background',
        'px-2 py-1 pr-6 text-xs max-w-[14rem]'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        title={attachment.name}
        aria-label={t('openPreview', { defaultValue: 'Open preview' })}
        className="flex items-center gap-1.5 truncate"
      >
        {isImage && attachment.dataUrl ? (
          <img
            src={attachment.dataUrl}
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
        <span className="truncate">{attachment.name}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('attachments.remove', {
          defaultValue: 'Remove attachment',
        })}
        title={t('attachments.remove', {
          defaultValue: 'Remove attachment',
        })}
        className={cn(
          'absolute right-1 top-1 rounded p-0.5',
          'opacity-50 hover:opacity-100 hover:bg-foreground/10',
          'motion-safe:transition-opacity'
        )}
        data-testid="compare-remove-attachment"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function MasterAttachmentPreview({
  open,
  onOpenChange,
  attachment,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  attachment: Attachment | null
}) {
  if (!attachment) return null
  const isImage = attachment.type === 'image'
  const isAudio = attachment.type === 'audio'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{attachment.name}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center max-h-[70vh] overflow-auto">
          {isImage && attachment.dataUrl ? (
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="max-w-full max-h-[60vh] object-contain rounded-md"
            />
          ) : isAudio && attachment.dataUrl ? (
            <audio controls src={attachment.dataUrl} className="w-full" />
          ) : (
            <div className="text-sm text-muted-foreground p-4">
              {attachment.path ?? attachment.mimeType ?? 'document'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MasterPromptInput
