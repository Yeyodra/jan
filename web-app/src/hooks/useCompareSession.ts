/**
 * useCompareSession — orchestrator hook for the ephemeral Compare feature.
 *
 * Drives N=2-6 parallel `Chat` instances against the ephemeral
 * `compare-session-store`. Deliberately bypasses `web-app/src/hooks/use-chat.ts`
 * (RF-1 opt-out) so this hook never writes into `chat-session-store`,
 * `useThreads`, or `useAttachments`. Memory-only, never persisted.
 *
 * Concurrency-critical contract:
 *  - Per-column AbortController + chat.stop() (defense-in-depth, TR-13).
 *  - maxRetries: 0 — no retry pollution (RF-10).
 *  - One column's onError MUST NOT abort siblings (Q3, Promise.allSettled).
 *  - Cleanup on unmount stops everything and clears the instance map.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Chat, type UIMessage } from '@ai-sdk/react'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import { ModelFactory } from '@/lib/model-factory'
import { useAppState } from '@/hooks/useAppState'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  useCompareSessionStore,
  useCompareIsAnyStreaming,
  useCompareCanSend,
  compareSafeUUID,
  COMPARE_MASTER_ATTACHMENT_KEY,
} from '@/stores/compare-session-store'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import type { Attachment } from '@/types/attachment'
import type { CompareColumn } from '@/types/compare'

// ---------------------------------------------------------------------------
// Per-column instance bookkeeping
// ---------------------------------------------------------------------------
//
// One Chat instance per column, reused across multiple sends in the same
// column (multi-turn). The Chat instance owns the streaming pipeline; the
// AbortController is rotated per-send.
type CompareInstance = {
  chat: Chat<UIMessage>
  transport: CustomChatTransport
  abortController: AbortController | null
  sessionId: string
  /** Reset on every sendToAll start; flipped true on first onChunk. */
  receivedFirstChunk: boolean
  /** Mirror of column.sendStartedAt captured at send-time so callbacks don't
   *  have to chase the latest store snapshot. */
  sendStartedAt: number | null
  /** Unsubscribe handle for the streaming-messages callback. Registered
   *  exactly once at instance creation; tied to the instance lifetime so it
   *  survives the many store mutations that happen between deltas (the
   *  earlier per-render useEffect approach reset the per-callback delta
   *  cursor on every flush — Bug 3, quadratic response duplication). */
  unregisterMessages: (() => void) | null
}

// ---------------------------------------------------------------------------
// RF-10 contract (no retries) is enforced inside the transport via the
// `maxRetries: 0` arg passed to `CustomChatTransport` below — the AI SDK plumbs
// retries through `streamText`, so the transport is the only point where the
// override actually lands.
// ---------------------------------------------------------------------------

function buildChat(
  transport: CustomChatTransport,
  sessionId: string
): Chat<UIMessage> {
  return new Chat<UIMessage>({ id: sessionId, transport })
}

/**
 * Convert processed `Attachment[]` (output of `processAttachmentsForSend`)
 * into the AI SDK `parts` shape consumed by both:
 *   - `chat.sendMessage({ files })` (for the wire dispatch — file parts only)
 *   - the `UIMessage.parts` we push into `column.messages` for history
 *     (text-inlined documents become `text` parts so users SEE the parsed
 *     content in the bubble; images and audio stay as `file` parts).
 *
 * Mirrors the shape used in routes/threads/$threadId.tsx:786-803 — Compare
 * deliberately reuses that contract so the transport's existing handlers
 * (audio sentinel injection, image dataUrl forwarding, vision-strip on
 * non-vision models) work without modification.
 */
function buildAttachmentParts(
  processed: Attachment[]
): Array<{
  type: 'file' | 'text'
  text?: string
  mediaType?: string
  url?: string
}> {
  const parts: Array<{
    type: 'file' | 'text'
    text?: string
    mediaType?: string
    url?: string
  }> = []
  for (const att of processed) {
    if (att.type === 'image' && att.dataUrl) {
      parts.push({
        type: 'file',
        mediaType: att.mimeType ?? 'image/jpeg',
        url: att.dataUrl,
      })
    } else if (att.type === 'audio' && att.dataUrl) {
      parts.push({
        type: 'file',
        mediaType: att.mimeType ?? 'audio/wav',
        url: att.dataUrl,
      })
    } else if (att.type === 'document') {
      // Inline content: include parsed text directly so the model sees it
      // without needing a RAG fetch. Compare deliberately doesn't run a
      // per-column embeddings index, so embeddings-mode documents are
      // surfaced as a small file-id citation instead of being silently
      // dropped (the model will see the marker and can ask for clarification).
      if (att.injectionMode === 'inline' && att.inlineContent) {
        parts.push({
          type: 'text',
          text: `\n[Attached file: ${att.name}]\n${att.inlineContent}\n`,
        })
      } else if (att.id) {
        parts.push({
          type: 'text',
          text: `\n[Attached file: ${att.name} (id: ${att.id})]\n`,
        })
      }
    }
  }
  return parts
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCompareSession() {
  // Selectors. Keep each one narrowly scoped so unrelated store mutations do
  // not re-render this hook's consumer.
  const columns = useCompareSessionStore((s) => s.columns)
  const masterPrompt = useCompareSessionStore((s) => s.masterPrompt)
  const isAnyStreaming = useCompareIsAnyStreaming()
  const canSend = useCompareCanSend()

  // Stable action references (zustand returns the same fn identity).
  const setMasterPromptAction = useCompareSessionStore((s) => s.setMasterPrompt)
  const addColumnAction = useCompareSessionStore((s) => s.addColumn)
  const removeColumnAction = useCompareSessionStore((s) => s.removeColumn)
  const clearAllAction = useCompareSessionStore((s) => s.clearAll)
  const setColumnStatus = useCompareSessionStore((s) => s.setColumnStatus)
  const setColumnMetrics = useCompareSessionStore((s) => s.setColumnMetrics)
  const setColumnError = useCompareSessionStore((s) => s.setColumnError)
  const markSendStartedAction = useCompareSessionStore((s) => s.markSendStarted)
  const appendMessageAction = useCompareSessionStore((s) => s.appendMessage)

  // Per-column instance cache. Keyed by column.id (NOT sessionId — the column
  // id is the user-facing identity that survives provider/model reselection
  // logic, even though the store currently never mutates it).
  const instances = useRef<Map<string, CompareInstance>>(new Map())

  // Per-column cursor for the streaming subscriber: the length of the last
  // assistant text we forwarded to the store. Lives in a ref keyed by
  // column.id so the cursor survives every store mutation between SDK
  // deltas. The earlier per-render `useEffect` approach reset this cursor
  // on every `flushPending` tick (because the effect re-subscribed when
  // `columns` got a new array reference), which caused the cumulative
  // assistant text to be re-emitted in full each delta — Bug 3, quadratic
  // response duplication (`HaloHalo!Halo! Saya...`).
  const lastAssistantLenRef = useRef<Map<string, number>>(new Map())

  // ---- helpers --------------------------------------------------------------

  const getOrCreateInstance = useCallback(
    (column: CompareColumn): CompareInstance => {
      const cached = instances.current.get(column.id)
      if (cached) return cached

      // Compare-prefixed threadId. T0 verified compare-prefixed thread IDs are
      // inert in `useThreads` / `useAttachments` because UI consumers
      // cross-check `useThreads.threads[id]` first. Belt-and-suspenders: even
      // though the store's sessionId is already a UUID, prefixing makes the
      // namespace obvious in devtools and logs.
      const threadId = `compare:${column.sessionId}`
      // Per-column identity (RF-1) AND no-retry contract (RF-10) flow through
      // the transport: it's the only seam that reaches `streamText`.
      // `forceSendAllParts: true` bypasses `stripUnsupportedImageParts` so
      // user-attached images reach every column verbatim — Compare's
      // philosophy is "send to all, let user judge"; capability gating
      // contradicts that. See `decisions.md` for full rationale.
      const transport = new CustomChatTransport(undefined, threadId, {
        modelOverride: { provider: column.provider, modelId: column.modelId },
        maxRetries: 0,
        forceSendAllParts: true,
      })

      const chat = buildChat(transport, threadId)

      const instance: CompareInstance = {
        chat,
        transport,
        abortController: null,
        sessionId: threadId,
        receivedFirstChunk: false,
        sendStartedAt: null,
        unregisterMessages: null,
      }

      // Subscribe ONCE per instance. The callback's identity must outlive
      // every store mutation that happens between SDK deltas — if we instead
      // re-subscribed from a useEffect with `columns` in the deps, the
      // closure-captured cursor would reset to 0 on every `flushPending`
      // tick and the cumulative-text delta would be re-emitted in full
      // (Bug 3: quadratic response duplication).
      const columnId = column.id
      const unsub = chat['~registerMessagesCallback'](() => {
        const msgs = chat.messages
        if (msgs.length === 0) return
        const last = msgs[msgs.length - 1]
        if (last.role !== 'assistant') return

        let text = ''
        const parts = (last.parts ?? []) as Array<{
          type: string
          text?: string
        }>
        for (const p of parts) {
          if (p.type === 'text' && typeof p.text === 'string') {
            text += p.text
          }
        }

        // Read store actions live — they're stable references, but pulling
        // them from `getState()` keeps the closure free of React-render
        // dependencies.
        const store = useCompareSessionStore.getState()

        if (
          !instance.receivedFirstChunk &&
          text.length > 0 &&
          instance.sendStartedAt != null
        ) {
          instance.receivedFirstChunk = true
          const ttftMs = performance.now() - instance.sendStartedAt
          store.setColumnMetrics(columnId, { ttftMs })
        }

        const prev = lastAssistantLenRef.current.get(columnId) ?? 0
        if (text.length > prev) {
          const delta = text.slice(prev)
          lastAssistantLenRef.current.set(columnId, text.length)
          store.updateAssistantStream(columnId, delta)
        } else if (text.length < prev) {
          // New assistant message started (next turn / regenerate / second
          // send). Reset the baseline and forward whatever the new message
          // already contains.
          lastAssistantLenRef.current.set(columnId, text.length)
          if (text.length > 0) store.updateAssistantStream(columnId, text)
        }
      }, 0)
      instance.unregisterMessages = unsub

      instances.current.set(column.id, instance)
      return instance
    },
    []
  )

  // ---- public actions -------------------------------------------------------

  const setMasterPrompt = useCallback(
    (text: string) => {
      setMasterPromptAction(text)
    },
    [setMasterPromptAction]
  )

  const addModel = useCallback(
    (provider: ModelProvider, modelId: string) => {
      addColumnAction(provider, modelId)
    },
    [addColumnAction]
  )

  const removeModel = useCallback(
    (providerId: string, modelId: string) => {
      const target = useCompareSessionStore
        .getState()
        .columns.find(
          (c) => c.provider.provider === providerId && c.modelId === modelId
        )
      if (!target) return

      const inst = instances.current.get(target.id)
      if (inst) {
        if (
          target.status === 'streaming' ||
          target.status === 'stopping'
        ) {
          try {
            inst.chat.stop()
          } catch {
            // best-effort
          }
          try {
            inst.abortController?.abort()
          } catch {
            // best-effort
          }
        }
        try {
          inst.unregisterMessages?.()
        } catch {
          // best-effort
        }
        // Drop the inert thread state in useAppState (T0 cleanup contract).
        try {
          useAppState.getState().clearThreadState(inst.sessionId)
        } catch {
          // best-effort
        }
        instances.current.delete(target.id)
      }
      // Drop the per-column streaming cursor so a future column reusing this
      // id (currently impossible — UUIDs — but defensive) doesn't inherit a
      // stale length.
      lastAssistantLenRef.current.delete(target.id)

      removeColumnAction(target.id)
    },
    [removeColumnAction]
  )

  const stopColumn = useCallback(
    (columnId: string) => {
      // Set status FIRST so the UI never lies about cancellation intent
      // (RF-2). The terminal status (`finished` / `error`) is set by the
      // chat's onFinish/onError when the abort actually lands.
      setColumnStatus(columnId, 'stopping')

      const inst = instances.current.get(columnId)
      if (!inst) return

      // Defense-in-depth (TR-13): both the SDK-level stop AND the lower-level
      // signal abort. Either one alone has been observed to leave streams
      // half-running depending on transport state.
      try {
        inst.chat.stop()
      } catch {
        // best-effort
      }
      try {
        inst.abortController?.abort()
      } catch {
        // best-effort
      }
    },
    [setColumnStatus]
  )

  const stopAll = useCallback(() => {
    const snapshot = useCompareSessionStore.getState().columns
    for (const col of snapshot) {
      if (col.status === 'streaming' || col.status === 'stopping') {
        stopColumn(col.id)
      }
    }
  }, [stopColumn])

  const clearAll = useCallback(() => {
    // Order matters: stop in-flight streams first so their onError/onFinish
    // callbacks have stale (but harmless) column references; THEN drop the
    // store state; THEN drop the instance map.
    stopAll()
    for (const inst of instances.current.values()) {
      try {
        inst.unregisterMessages?.()
      } catch {
        // best-effort
      }
      try {
        useAppState.getState().clearThreadState(inst.sessionId)
      } catch {
        // best-effort
      }
    }
    clearAllAction()
    instances.current.clear()
    lastAssistantLenRef.current.clear()
  }, [clearAllAction, stopAll])

  const sendToAll = useCallback(
    (prompt: string) => {
      const trimmed = prompt.trim()
      const snapshot = useCompareSessionStore.getState().columns
      // UI gates via canSend; this is defense-in-depth.
      if (snapshot.length < 2 || trimmed.length === 0) return

      // Snapshot the master attachment tray ONCE up front. Every column
      // sends the same prompt + same attachments — that's the whole point of
      // /compare. The processAttachmentsForSend call below normalizes them
      // (parses documents inline, ingests images) using the first column's
      // thread id as a stable scope. Compare is ephemeral (memory-only, no
      // persistence) so any side-effects of ingestion are throwaway.
      //
      // Note: per-turn persistence is enforced by clearing this tray right
      // after dispatch fans out — turn 1's attachments live on inside each
      // column's `messages[turn1].parts` (UIMessage history), so the master
      // input is ready for a fresh attachment set on turn 2 without losing
      // history.
      const chatAtt = useChatAttachments.getState()
      const masterAttachments = chatAtt.getAttachments(
        COMPARE_MASTER_ATTACHMENT_KEY
      )

      // Fire-and-forget the body. We need an async wrapper because attachment
      // processing is async and the dispatches Promise.allSettled below has
      // to wait on the processing result.
      const run = async () => {
        // 1. Process attachments once (parse documents, ingest images).
        //    Use the FIRST column's thread id so the scope is well-defined;
        //    the resulting `parts` are reused across every column.
        let attachmentParts: Array<{
          type: 'file' | 'text'
          text?: string
          mediaType?: string
          url?: string
        }> = []
        if (masterAttachments.length > 0) {
          try {
            const masterThreadId = `compare:${snapshot[0].sessionId}`
            const result = await processAttachmentsForSend({
              attachments: masterAttachments,
              threadId: masterThreadId,
              serviceHub: getServiceHub(),
              // Compare has no per-column retrieval, so embeddings-mode docs would
              // surface as a citation marker only with no content reaching the model.
              // Force inline so PDF/text content is parsed and injected into the user
              // message body verbatim. /threads still uses 'auto' (its default) and
              // is unaffected.
              parsePreference: 'inline',
            })
            attachmentParts = buildAttachmentParts(result.processedAttachments)
          } catch (err) {
            // If processing fails, surface as an error on every column so
            // users can see what happened rather than silently sending text.
            const message =
              err instanceof Error ? err.message : String(err)
            for (const col of snapshot) {
              setColumnError(col.id, message)
              setColumnStatus(col.id, 'error')
            }
            return
          }
        }

        // 2. Per-turn cleanup: clear the master attachment tray. The
        //    just-built `attachmentParts` are captured in closure for every
        //    column dispatch below, and each column's user UIMessage will
        //    keep its own copy in `parts` for history. The tray itself is
        //    now free for the user to attach a fresh set for turn N+1.
        chatAtt.clearAttachments(COMPARE_MASTER_ATTACHMENT_KEY)

        // 3. Fire all columns in parallel. allSettled so one column's
        //    failure never short-circuits siblings (Q3).
        const dispatches = snapshot.map(async (column) => {
          const inst = getOrCreateInstance(column)
          const ac = new AbortController()
          const startedAt = performance.now()

          inst.abortController = ac
          inst.receivedFirstChunk = false
          inst.sendStartedAt = startedAt
          // Reset the streaming cursor so a fresh send starts diffing from 0
          // even if the previous turn left a stale length cached.
          lastAssistantLenRef.current.set(column.id, 0)

          // 3a. Append the user bubble FIRST so the column transcript shows
          //     the prompt immediately (Bug 5A fix). The store's flushPending
          //     batches this with the assistant frame below into a single
          //     rAF tick, so React only sees one render.
          const userParts: Array<{
            type: string
            text?: string
            mediaType?: string
            url?: string
          }> = [{ type: 'text', text: trimmed }, ...attachmentParts]
          const userMessage = {
            id: compareSafeUUID(),
            role: 'user',
            parts: userParts,
          } as unknown as UIMessage
          appendMessageAction(column.id, userMessage)

          // 3b. Force a NEW empty assistant frame so streaming deltas land
          //     here instead of being merged into the previous turn's
          //     trailing assistant message (Bug 5B fix — turns dempet).
          //     flushPending lays the first textAppend into a fresh
          //     {type:'text'} part because parts is empty.
          const assistantStub = {
            id: compareSafeUUID(),
            role: 'assistant',
            parts: [],
          } as unknown as UIMessage
          appendMessageAction(column.id, assistantStub)

          markSendStartedAction(column.id, startedAt)
          setColumnError(column.id, null)
          setColumnStatus(column.id, 'streaming')

          // Build a fresh LanguageModel per column. The transport reads model
          // selection from `useModelProvider` at send-time; pre-resolving here
          // lets us surface "model unconstructible" failures (missing API key,
          // unknown provider) BEFORE the chat starts so the column shows
          // `error` instead of hanging in `streaming`.
          try {
            await ModelFactory.createModel(column.modelId, column.provider, {})
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err)
            setColumnError(column.id, message)
            setColumnStatus(column.id, 'error')
            inst.abortController = null
            return
          }

          try {
            // Build the SDK message. The SDK accepts `text` for plain text
            // OR `files` (array of {type:'file', mediaType, url}) for
            // multi-modal. We forward the SAME attachment parts to every
            // column with NO capability gating — transport's existing
            // auto-strip behavior (custom-chat-transport.ts modelHasVision
            // ternary) handles text-only models gracefully. User keeps
            // explicit control via the Edit Model dialog.
            const sdkFiles = attachmentParts
              .filter((p): p is { type: 'file'; mediaType: string; url: string } =>
                p.type === 'file' &&
                typeof p.mediaType === 'string' &&
                typeof p.url === 'string'
              )
              .map((p) => ({
                type: 'file' as const,
                mediaType: p.mediaType,
                url: p.url,
              }))
            const sendArgs: { text: string; files?: typeof sdkFiles } =
              sdkFiles.length > 0
                ? { text: trimmed, files: sdkFiles }
                : { text: trimmed }

            await inst.chat.sendMessage(
              sendArgs,
              { body: {} } // ChatRequestOptions; transport reads abort via SDK plumbing
            )
            // sendMessage resolves only when the stream is done. Status flips
            // to `finished` here unless an abort/error happened first.
            if (
              useCompareSessionStore.getState().columns.find(
                (c) => c.id === column.id
              )?.status === 'streaming'
            ) {
              const totalMs = performance.now() - startedAt
              setColumnMetrics(column.id, { totalMs })
              setColumnStatus(column.id, 'finished')
            } else if (
              useCompareSessionStore.getState().columns.find(
                (c) => c.id === column.id
              )?.status === 'stopping'
            ) {
              // Aborted via stopColumn — terminal state is `finished` (the
              // user-visible end of the stream regardless of cause).
              setColumnStatus(column.id, 'finished')
            }
          } catch (err) {
            // Aborts surface as errors here in some SDK versions; treat
            // intentional aborts as `finished` so the UI doesn't show an error
            // pill for a user-initiated stop.
            if (ac.signal.aborted) {
              setColumnStatus(column.id, 'finished')
            } else {
              const message =
                err instanceof Error ? err.message : String(err)
              setColumnError(column.id, message)
              setColumnStatus(column.id, 'error')
            }
          } finally {
            inst.abortController = null
          }
        })

        // Detach. The hook does not expose a "wait for all sends" API — the
        // store IS the source of truth for completion.
        await Promise.allSettled(dispatches)
      }

      void run()
    },
    [
      appendMessageAction,
      getOrCreateInstance,
      markSendStartedAction,
      setColumnError,
      setColumnMetrics,
      setColumnStatus,
    ]
  )

  // ---- cleanup on unmount --------------------------------------------------
  //
  // Stops every in-flight stream, drops inert thread state from useAppState
  // (the only store the transport DOES write to), and clears the instance
  // map. ALL of this is best-effort; an exception in cleanup is never fatal.
  useEffect(() => {
    return () => {
      for (const inst of instances.current.values()) {
        try {
          inst.chat.stop()
        } catch {
          // best-effort
        }
        try {
          inst.abortController?.abort()
        } catch {
          // best-effort
        }
        try {
          inst.unregisterMessages?.()
        } catch {
          // best-effort
        }
        try {
          useAppState.getState().clearThreadState(inst.sessionId)
        } catch {
          // best-effort
        }
      }
      instances.current.clear()
      lastAssistantLenRef.current.clear()
    }
  }, [])

  return {
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
  }
}
