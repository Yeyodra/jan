/**
 * Ephemeral compare-session store.
 * Memory only — no persist. Resets on app close.
 * Not subscribed to chat-session-store.
 */
import { create } from 'zustand'
import type { UIMessage } from '@ai-sdk/react'
import type {
  CompareColumn,
  CompareColumnMetrics,
  CompareColumnStatus,
} from '@/types/compare'

const MAX_COLUMNS = 6

/**
 * Stable key under which the master prompt's pending attachments live in the
 * shared `useChatAttachments` store. Compare reuses the /threads attachment
 * infrastructure wholesale; the only difference is that attachments are
 * GLOBAL to the master prompt (not per-column) and clear on every Send All.
 *
 * Single string constant — Compare is single-page, never multi-instance, so
 * a per-session-id key would just add ceremony without any real benefit.
 */
export const COMPARE_MASTER_ATTACHMENT_KEY = '__compare-master__'

// Stable empty arrays so selectors don't trigger unnecessary re-renders.
const EMPTY_COLUMNS: CompareColumn[] = []

type CompareSessionStateShape = {
  columns: CompareColumn[]
  masterPrompt: string
}

type CompareSessionActions = {
  setMasterPrompt: (text: string) => void
  addColumn: (provider: ModelProvider, modelId: string) => void
  removeColumn: (id: string) => void
  clearAllColumns: () => void
  appendMessage: (columnId: string, msg: UIMessage) => void
  updateAssistantStream: (columnId: string, deltaText: string) => void
  setColumnStatus: (columnId: string, status: CompareColumnStatus) => void
  setColumnMetrics: (
    columnId: string,
    partial: Partial<CompareColumnMetrics>
  ) => void
  setColumnError: (columnId: string, error: string | null) => void
  markSendStarted: (columnId: string, ts: number) => void
  clearAll: () => void
}

type CompareSessionStore = CompareSessionStateShape & CompareSessionActions

// ---------------------------------------------------------------------------
// rAF batching
// ---------------------------------------------------------------------------
//
// N=6 streaming columns × tens of deltas/sec each saturates the Tauri webview
// when every onChunk triggers a setState. We coalesce all pending deltas (and
// any pending appendMessage calls) into a single rAF tick: at most one
// setState per frame, regardless of how many columns are streaming.
//
// `pendingFlushes` is module-private mutable state. It is intentionally NOT
// stored in Zustand — it is a write-buffer, not state. Only the merged result
// is committed via `set()` inside `flushPending`.
type PendingEntry = {
  textAppend: string
  pendingMessages: UIMessage[]
}
const pendingFlushes = new Map<string, PendingEntry>()
let rafHandle: number | null = null

function getEntry(columnId: string): PendingEntry {
  let entry = pendingFlushes.get(columnId)
  if (!entry) {
    entry = { textAppend: '', pendingMessages: [] }
    pendingFlushes.set(columnId, entry)
  }
  return entry
}

function hasRaf(): boolean {
  return typeof requestAnimationFrame !== 'undefined'
}

function scheduleFlush(): void {
  if (rafHandle !== null) return
  if (!hasRaf()) {
    // SSR / non-browser fallback: flush synchronously. Tests run in jsdom
    // which provides rAF, so the real batching path is exercised there.
    flushPending()
    return
  }
  rafHandle = requestAnimationFrame(flushPending)
}

function flushPending(): void {
  rafHandle = null
  if (pendingFlushes.size === 0) return

  // Snapshot + clear synchronously so any deltas arriving during set() land
  // in a fresh frame.
  const snapshot = new Map(pendingFlushes)
  pendingFlushes.clear()

  useCompareSessionStore.setState((state) => {
    let changed = false
    const nextColumns = state.columns.map((column) => {
      const entry = snapshot.get(column.id)
      if (!entry) return column
      if (entry.textAppend === '' && entry.pendingMessages.length === 0) {
        return column
      }
      changed = true

      let messages = column.messages

      // 1) Append any whole messages queued for this column FIRST. Order
      //    matters: in a typical send flow the caller does
      //    `appendMessage(user)` immediately followed by streamed assistant
      //    deltas. Both land in the same frame; the user message must come
      //    before the streamed assistant message in the rendered transcript.
      if (entry.pendingMessages.length > 0) {
        messages = [...messages, ...entry.pendingMessages]
      }

      // 2) Merge streamed text into the trailing assistant message, or start
      //    a fresh assistant message if the stream just began (which is the
      //    common case when a user message was just appended above).
      if (entry.textAppend !== '') {
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          const parts = (last.parts ?? []) as Array<{
            type: string
            text?: string
          }>
          const lastPart = parts[parts.length - 1]
          let nextParts: typeof parts
          if (lastPart && lastPart.type === 'text') {
            nextParts = [
              ...parts.slice(0, -1),
              { ...lastPart, text: (lastPart.text ?? '') + entry.textAppend },
            ]
          } else {
            nextParts = [...parts, { type: 'text', text: entry.textAppend }]
          }
          const updatedLast = { ...last, parts: nextParts } as UIMessage
          messages = [...messages.slice(0, -1), updatedLast]
        } else {
          const fresh = {
            id: safeUUID(),
            role: 'assistant',
            parts: [{ type: 'text', text: entry.textAppend }],
          } as unknown as UIMessage
          messages = [...messages, fresh]
        }
      }

      return { ...column, messages }
    })

    return changed ? { columns: nextColumns } : state
  })
}

/**
 * Generate a UUID for client-side ephemeral message ids. Exported so consumer
 * hooks (useCompareSession) can stamp the user / assistant `UIMessage` ids
 * they push through `appendMessage` with the same fallback policy.
 */
export function compareSafeUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID. Not security-grade,
  // but good enough for client-side ephemeral ids in legacy webviews.
  return 'cmp-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Internal alias kept so the rest of this module doesn't get noisy.
const safeUUID = compareSafeUUID

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCompareSessionStore = create<CompareSessionStore>(
  (set, get) => ({
    columns: EMPTY_COLUMNS,
    masterPrompt: '',

    setMasterPrompt: (text) => {
      set({ masterPrompt: text })
    },

    addColumn: (provider, modelId) => {
      const state = get()

      // Cap silently at MAX_COLUMNS — UI gates at 6, this is defense in depth.
      if (state.columns.length >= MAX_COLUMNS) return

      // Duplicate (provider, modelId) is a deliberate no-op. The Compare panel
      // disallows the same model twice; this guards against double-clicks /
      // racing UI events.
      const providerName = provider.provider
      if (
        state.columns.some(
          (c) => c.provider.provider === providerName && c.modelId === modelId
        )
      ) {
        return
      }

      const id = safeUUID()
      const sessionId = safeUUID()

      // sessionId collision is effectively impossible with crypto.randomUUID,
      // but the invariant is load-bearing: per-column threads MUST be
      // isolated. In dev, fail fast; in prod, log + skip.
      if (state.columns.some((c) => c.sessionId === sessionId)) {
        const msg = 'Compare invariant: sessionId collision'
        if (import.meta.env.DEV) {
          throw new Error(msg)
        }
        console.error(msg)
        return
      }

      const column: CompareColumn = {
        id,
        sessionId,
        provider,
        modelId,
        status: 'idle',
        messages: [],
        metrics: { ttftMs: null, totalMs: null, outputTokens: null },
        error: null,
        sendStartedAt: null,
      }

      set({ columns: [...state.columns, column] })
    },

    removeColumn: (id) => {
      pendingFlushes.delete(id)
      set((state) => {
        const next = state.columns.filter((c) => c.id !== id)
        if (next.length === state.columns.length) return state
        return { columns: next }
      })
    },

    clearAllColumns: () => {
      pendingFlushes.clear()
      set((state) =>
        state.columns.length === 0 ? state : { columns: EMPTY_COLUMNS }
      )
    },

    appendMessage: (columnId, msg) => {
      const entry = getEntry(columnId)
      entry.pendingMessages.push(msg)
      scheduleFlush()
    },

    updateAssistantStream: (columnId, deltaText) => {
      if (deltaText === '') return
      const entry = getEntry(columnId)
      entry.textAppend += deltaText
      scheduleFlush()
    },

    setColumnStatus: (columnId, status) => {
      set((state) => {
        let changed = false
        const next = state.columns.map((c) => {
          if (c.id !== columnId || c.status === status) return c
          changed = true
          return { ...c, status }
        })
        return changed ? { columns: next } : state
      })
    },

    setColumnMetrics: (columnId, partial) => {
      set((state) => {
        let changed = false
        const next = state.columns.map((c) => {
          if (c.id !== columnId) return c
          changed = true
          return { ...c, metrics: { ...c.metrics, ...partial } }
        })
        return changed ? { columns: next } : state
      })
    },

    setColumnError: (columnId, error) => {
      set((state) => {
        let changed = false
        const next = state.columns.map((c) => {
          if (c.id !== columnId || c.error === error) return c
          changed = true
          return { ...c, error }
        })
        return changed ? { columns: next } : state
      })
    },

    markSendStarted: (columnId, ts) => {
      set((state) => {
        let changed = false
        const next = state.columns.map((c) => {
          if (c.id !== columnId) return c
          changed = true
          return { ...c, sendStartedAt: ts }
        })
        return changed ? { columns: next } : state
      })
    },

    clearAll: () => {
      pendingFlushes.clear()
      // Leave any in-flight rafHandle alone: flushPending() sees an empty map
      // and returns without touching state.
      set({ columns: EMPTY_COLUMNS, masterPrompt: '' })
    },
  })
)

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const useCompareIsAnyStreaming = (): boolean =>
  useCompareSessionStore((s) =>
    s.columns.some((c) => c.status === 'streaming' || c.status === 'stopping')
  )

export const useCompareCanSend = (): boolean =>
  useCompareSessionStore(
    (s) =>
      s.columns.length >= 2 &&
      !s.columns.some(
        (c) => c.status === 'streaming' || c.status === 'stopping'
      ) &&
      s.masterPrompt.trim().length > 0
  )
