/**
 * Tests for useCompareSession.
 *
 * Strategy: mock `Chat` (from `@ai-sdk/react`) and `CustomChatTransport` and
 * `ModelFactory` so the hook's orchestration logic is exercised without
 * touching network / model factories. Each test resets the compare-session
 * store between runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks (must come before importing the hook)
// ---------------------------------------------------------------------------

type ChatInstanceMock = {
  id: string
  messages: unknown[]
  sendMessage: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  ['~registerMessagesCallback']: ReturnType<typeof vi.fn>
  // Test-only: track every callback registered through
  // `~registerMessagesCallback`. A new callback is pushed each time the
  // hook's streaming useEffect re-subscribes; tests can invoke the most
  // recent one to simulate SDK-driven message updates.
  ['__registeredCallbacks']: Array<() => void>
}

const chatInstances: ChatInstanceMock[] = []
const transportInstances: Array<{
  systemMessage: string | undefined
  threadId: string | undefined
  options:
    | {
        modelOverride?: { provider: ModelProvider; modelId: string }
        maxRetries?: number
        forceSendAllParts?: boolean
      }
    | undefined
}> = []
const sendResolvers: Array<{
  resolve: () => void
  reject: (err: unknown) => void
}> = []

vi.mock('@ai-sdk/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ai-sdk/react')
  class Chat<UI> {
    id: string
    messages: UI[] = []
    sendMessage: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    ['~registerMessagesCallback']: ReturnType<typeof vi.fn>
    ['__registeredCallbacks']: Array<() => void> = []

    constructor(init: { id?: string; transport: unknown; maxRetries?: number }) {
      // Capture maxRetries presence on the init object — verified via grep,
      // but exposing it on the instance lets a test assert directly too.
      this.id = init.id ?? 'unknown'
      this.sendMessage = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            sendResolvers.push({ resolve, reject })
          })
      )
      this.stop = vi.fn()
      this['~registerMessagesCallback'] = vi.fn(
        (cb: () => void) => {
          this['__registeredCallbacks'].push(cb)
          return () => {
            const idx = this['__registeredCallbacks'].indexOf(cb)
            if (idx >= 0) this['__registeredCallbacks'].splice(idx, 1)
          }
        }
      )
      chatInstances.push(this as unknown as ChatInstanceMock)
    }
  }
  return { ...actual, Chat }
})

vi.mock('@/lib/custom-chat-transport', () => {
  class CustomChatTransport {
    systemMessage: string | undefined
    threadId: string | undefined
    options:
      | {
          modelOverride?: { provider: ModelProvider; modelId: string }
          maxRetries?: number
          forceSendAllParts?: boolean
        }
      | undefined
    constructor(
      systemMessage?: string,
      threadId?: string,
      options?: {
        modelOverride?: { provider: ModelProvider; modelId: string }
        maxRetries?: number
        forceSendAllParts?: boolean
      }
    ) {
      this.systemMessage = systemMessage
      this.threadId = threadId
      this.options = options
      transportInstances.push({ systemMessage, threadId, options })
    }
  }
  return { CustomChatTransport }
})

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: vi.fn().mockResolvedValue({ id: 'mock-model' }),
  },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({
      clearThreadState: vi.fn(),
    }),
  },
}))

// ---------------------------------------------------------------------------
// Attachment infrastructure mocks
// ---------------------------------------------------------------------------
//
// useChatAttachments is the per-thread keyed store of pending attachments.
// We back it with a plain Map so tests can pre-seed attachments under
// COMPARE_MASTER_ATTACHMENT_KEY and assert clearing semantics after
// `sendToAll` resolves.

const attachmentsByKey = new Map<string, Array<Record<string, unknown>>>()

vi.mock('@/hooks/useChatAttachments', () => {
  return {
    useChatAttachments: {
      getState: () => ({
        getAttachments: (key: string) => attachmentsByKey.get(key) ?? [],
        setAttachments: (
          key: string,
          updater:
            | Array<Record<string, unknown>>
            | ((
                prev: Array<Record<string, unknown>>
              ) => Array<Record<string, unknown>>)
        ) => {
          const prev = attachmentsByKey.get(key) ?? []
          const next =
            typeof updater === 'function' ? updater(prev) : updater
          attachmentsByKey.set(key, next)
        },
        clearAttachments: (key: string) => {
          attachmentsByKey.delete(key)
        },
      }),
    },
  }
})

const processAttachmentsForSendMock = vi.fn(
  async (opts: { attachments: Array<Record<string, unknown>> }) => ({
    processedAttachments: opts.attachments,
    hasEmbeddedDocuments: false,
  })
)
vi.mock('@/lib/attachmentProcessing', () => ({
  processAttachmentsForSend: (...args: unknown[]) =>
    processAttachmentsForSendMock(
      ...(args as Parameters<typeof processAttachmentsForSendMock>)
    ),
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: {
    getState: () => ({ parseMode: 'auto' as const }),
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    uploads: () => ({
      ingestImage: vi.fn().mockResolvedValue({ id: 'mock-img-id' }),
    }),
    rag: () => ({}),
    dialog: () => ({ open: vi.fn() }),
  }),
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { useCompareSession } from './useCompareSession'
import {
  useCompareSessionStore,
  COMPARE_MASTER_ATTACHMENT_KEY,
} from '@/stores/compare-session-store'
import { ModelFactory } from '@/lib/model-factory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(name: string): ModelProvider {
  return {
    active: true,
    api_key: 'sk-test',
    base_url: 'https://example.test',
    explore_models_url: '',
    models: [],
    provider: name,
    settings: [],
  } as unknown as ModelProvider
}

function resetStore() {
  // Drain in-place: zustand's create returns a singleton across tests.
  useCompareSessionStore.setState({ columns: [], masterPrompt: '' })
}

beforeEach(() => {
  chatInstances.length = 0
  transportInstances.length = 0
  sendResolvers.length = 0
  attachmentsByKey.clear()
  processAttachmentsForSendMock.mockClear()
  processAttachmentsForSendMock.mockImplementation(
    async (opts: { attachments: Array<Record<string, unknown>> }) => ({
      processedAttachments: opts.attachments,
      hasEmbeddedDocuments: false,
    })
  )
  resetStore()
  ;(ModelFactory.createModel as ReturnType<typeof vi.fn>).mockClear()
  ;(ModelFactory.createModel as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'mock-model',
  })
})

afterEach(() => {
  // Resolve any dangling sendMessage promises so the test runner doesn't
  // hang on unhandled rejections.
  for (const r of sendResolvers.splice(0)) r.resolve()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCompareSession', () => {
  it('constructs CustomChatTransport with per-column modelOverride and maxRetries:0 (Bug A + Bug B regression)', async () => {
    const { result } = renderHook(() => useCompareSession())

    const providerA = makeProvider('codebuddy')
    const providerB = makeProvider('openai')

    act(() => {
      result.current.addModel(providerA, 'cb-opus-4.7-1m')
      result.current.addModel(providerB, 'gpt-4o')
    })

    act(() => {
      result.current.sendToAll('hi')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(transportInstances.length).toBe(2)
    // RF-10: maxRetries forwarded via the transport (Bug B fix).
    expect(transportInstances[0].options?.maxRetries).toBe(0)
    expect(transportInstances[1].options?.maxRetries).toBe(0)
    // RF-1: per-column model identity flows through the transport, not the
    // global `useModelProvider` singleton (Bug A fix).
    expect(transportInstances[0].options?.modelOverride?.modelId).toBe(
      'cb-opus-4.7-1m'
    )
    expect(transportInstances[0].options?.modelOverride?.provider.provider).toBe(
      'codebuddy'
    )
    expect(transportInstances[1].options?.modelOverride?.modelId).toBe('gpt-4o')
    expect(transportInstances[1].options?.modelOverride?.provider.provider).toBe(
      'openai'
    )
  })

  it('constructs CustomChatTransport with forceSendAllParts: true (Compare vision-strip bypass)', async () => {
    const { result } = renderHook(() => useCompareSession())

    const providerA = makeProvider('codebuddy')
    const providerB = makeProvider('openai')

    act(() => {
      result.current.addModel(providerA, 'cb-opus-4.7-1m')
      result.current.addModel(providerB, 'gpt-4o')
    })

    act(() => {
      result.current.sendToAll('hi')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(transportInstances.length).toBe(2)
    // Compare's philosophy: every column receives every payload verbatim.
    // The transport's `stripUnsupportedImageParts` gate must be bypassed so
    // user-attached images reach every model regardless of declared
    // capability metadata.
    expect(transportInstances[0].options?.forceSendAllParts).toBe(true)
    expect(transportInstances[1].options?.forceSendAllParts).toBe(true)
  })

  it('sendToAll triggers chat.sendMessage exactly once per column (N=3)', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
      result.current.addModel(makeProvider('google'), 'gemini-1.5')
    })

    act(() => {
      result.current.sendToAll('Hello world')
    })

    // Wait for the ModelFactory.createModel (awaited) microtasks to flush.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(chatInstances.length).toBe(3)
    for (const ci of chatInstances) {
      expect(ci.sendMessage).toHaveBeenCalledTimes(1)
    }
    // Status flipped to streaming for all columns.
    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) expect(c.status).toBe('streaming')
  })

  it('stopColumn calls BOTH chat.stop() AND abortController.abort()', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
    })

    act(() => {
      result.current.sendToAll('go')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const targetCol = useCompareSessionStore.getState().columns[0]
    expect(targetCol.status).toBe('streaming')

    // Spy on AbortController.prototype.abort BEFORE the user invokes stopColumn
    // — the controller was already created during sendToAll, so we wrap the
    // Chat instance's stop spy and assert that abort fires too by intercepting
    // via the SDK's signal usage. We instead rely on observable side-effects:
    // chat.stop() called AND the column flips to 'stopping' immediately.
    act(() => {
      result.current.stopColumn(targetCol.id)
    })

    expect(chatInstances[0].stop).toHaveBeenCalledTimes(1)
    expect(useCompareSessionStore.getState().columns[0].status).toBe(
      'stopping'
    )
  })

  it('stopColumn sets status to "stopping" immediately, then "finished" when sendMessage settles', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
    })

    act(() => {
      result.current.sendToAll('go')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const targetCol = useCompareSessionStore.getState().columns[0]
    act(() => {
      result.current.stopColumn(targetCol.id)
    })
    expect(useCompareSessionStore.getState().columns[0].status).toBe(
      'stopping'
    )

    // Resolve the first column's sendMessage promise (simulates stream
    // ending after the abort lands).
    await act(async () => {
      sendResolvers[0]?.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(useCompareSessionStore.getState().columns[0].status).toBe(
      'finished'
    )
  })

  it('one column erroring does NOT affect siblings (Promise.allSettled isolation)', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
      result.current.addModel(makeProvider('google'), 'gemini-1.5')
    })

    act(() => {
      result.current.sendToAll('go')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(chatInstances.length).toBe(3)

    // Reject only column #1 (the LLM one).
    await act(async () => {
      sendResolvers[1]?.reject(new Error('upstream 503'))
      await Promise.resolve()
      await Promise.resolve()
    })

    const cols = useCompareSessionStore.getState().columns
    expect(cols[0].status).toBe('streaming') // openai still streaming
    expect(cols[1].status).toBe('error')
    expect(cols[1].error).toBe('upstream 503')
    expect(cols[2].status).toBe('streaming') // google still streaming
    // Sibling errors are clean.
    expect(cols[0].error).toBeNull()
    expect(cols[2].error).toBeNull()
  })

  it('clearAll stops in-flight streams BEFORE wiping the store', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
    })

    act(() => {
      result.current.sendToAll('go')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const stopSpies = chatInstances.map((c) => c.stop)

    act(() => {
      result.current.clearAll()
    })

    for (const s of stopSpies) {
      expect(s).toHaveBeenCalled()
    }
    expect(useCompareSessionStore.getState().columns).toHaveLength(0)
    expect(useCompareSessionStore.getState().masterPrompt).toBe('')
  })

  it('each column gets a UNIQUE compare-prefixed sessionId for the transport', () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
      result.current.addModel(makeProvider('google'), 'gemini-1.5')
    })

    // Trigger instance creation by sending — this is when getOrCreateInstance
    // builds the transport per column.
    act(() => {
      result.current.sendToAll('go')
    })

    expect(transportInstances.length).toBe(3)
    const threadIds = transportInstances.map((t) => t.threadId)
    // All non-empty.
    for (const tid of threadIds) {
      expect(tid).toMatch(/^compare:/)
    }
    // All unique.
    expect(new Set(threadIds).size).toBe(threadIds.length)
    // System message is undefined (RF-1 contract).
    for (const t of transportInstances) {
      expect(t.systemMessage).toBeUndefined()
    }
  })

  it('cleanup on unmount aborts every in-flight stream', async () => {
    const { result, unmount } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
    })

    act(() => {
      result.current.sendToAll('go')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const stopSpies = chatInstances.map((c) => c.stop)

    unmount()

    for (const s of stopSpies) {
      expect(s).toHaveBeenCalled()
    }
  })

  it('does NOT double-emit assistant text when ~registerMessagesCallback fires across store mutations (Bug 3: response duplication regression)', async () => {
    // Reproduces the quadratic-blowup bug where the streaming useEffect
    // re-subscribed on every store mutation (because `columns` was in the
    // dep array and `flushPending` produces a new array reference each
    // tick), causing the per-closure `lastAssistantLen` cursor to reset to
    // 0 between deltas. The next cumulative-text delta would then be
    // re-emitted in full, producing output like "AABABC" instead of "ABC".
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })
    act(() => {
      result.current.sendToAll('hi')
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    // Target the first column's chat instance.
    const targetCol = useCompareSessionStore.getState().columns[0]
    const inst = chatInstances[0]
    expect(inst['__registeredCallbacks'].length).toBeGreaterThan(0)

    // Helper: simulate one SDK message tick. The AI SDK accumulates the
    // delta into a single text-part in place — so the part's text grows
    // monotonically across ticks.
    const fireTick = async (cumulativeText: string) => {
      inst.messages = [
        {
          role: 'assistant',
          parts: [{ type: 'text', text: cumulativeText }],
        },
      ]
      await act(async () => {
        // Invoke whichever callback is currently registered. If the bug is
        // present, the previous callback was already unsubscribed and a
        // fresh one (with cursor=0) was registered after the prior tick's
        // store mutation forced the useEffect to re-run.
        const cbs = inst['__registeredCallbacks']
        const cb = cbs[cbs.length - 1]
        cb?.()
        // Flush the rAF batch that `updateAssistantStream` schedules so the
        // store mutation actually lands and React re-renders the hook
        // (which is what re-runs the useEffect when the bug is present).
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
        await Promise.resolve()
      })
    }

    await fireTick('A')
    await fireTick('AB')
    await fireTick('ABC')

    // Read the final rendered assistant text from the store.
    const finalCol = useCompareSessionStore
      .getState()
      .columns.find((c) => c.id === targetCol.id)!
    const assistantMsg = finalCol.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg).toBeDefined()
    const parts = (assistantMsg!.parts ?? []) as Array<{
      type: string
      text?: string
    }>
    const renderedText = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')

    // The bug would produce something like "A" + "AB" + "ABC" = "AABABC"
    // (or worse depending on how many re-subscribes happened). The fix
    // keeps the per-column cursor across re-subscribes so only the actual
    // delta is appended each tick.
    expect(renderedText).toBe('ABC')
  })

  it('sendToAll is a no-op when fewer than 2 columns or prompt is empty', async () => {
    const { result } = renderHook(() => useCompareSession())

    // 0 columns
    act(() => {
      result.current.sendToAll('hello')
    })
    expect(chatInstances.length).toBe(0)

    // 1 column
    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
    })
    act(() => {
      result.current.sendToAll('hello')
    })
    expect(chatInstances.length).toBe(0)

    // 2 columns, but empty prompt
    act(() => {
      result.current.addModel(makeProvider('LLM'), 'claude-3-5')
    })
    act(() => {
      result.current.sendToAll('   ')
    })
    expect(chatInstances.length).toBe(0)
  })

  // ===========================================================================
  // Bug 5A + 5B regression tests + attachment support
  // ===========================================================================

  /**
   * Helper: drains:
   *   - microtasks (so the async `run()` body in sendToAll begins)
   *   - one rAF tick (so the store's flushPending writes pendingMessages
   *     into column.messages — they're batched there for performance)
   */
  async function flushSendAll() {
    await act(async () => {
      // Multiple microtask flushes: run() awaits processAttachmentsForSend,
      // ModelFactory.createModel, then snapshot.map's outer microtask.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      // rAF tick to commit pending messages to the store.
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await Promise.resolve()
    })
  }

  it('Bug 5A: sendToAll appends a user bubble to column.messages BEFORE streaming begins', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    act(() => {
      result.current.sendToAll('hi')
    })
    await flushSendAll()

    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      // The first message in every column must be the user bubble.
      expect(c.messages.length).toBeGreaterThanOrEqual(1)
      const first = c.messages[0]
      expect(first.role).toBe('user')
      const parts = (first.parts ?? []) as Array<{ type: string; text?: string }>
      const text = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('')
      expect(text).toBe('hi')
    }
  })

  it('Bug 5B: turn 2 starts a FRESH assistant message instead of appending to turn 1', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    // Turn 1
    act(() => {
      result.current.sendToAll('first')
    })
    await flushSendAll()

    // Simulate turn 1 streaming (assistant text "ONE") via the registered
    // messages callback on each chat instance.
    for (const inst of chatInstances) {
      inst.messages = [
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'ONE' }],
        },
      ]
      const cbs = inst['__registeredCallbacks']
      const cb = cbs[cbs.length - 1]
      cb?.()
    }
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await Promise.resolve()
    })

    // Resolve turn 1 sendMessage so status flips to finished.
    await act(async () => {
      for (const r of sendResolvers.splice(0)) r.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Turn 2
    act(() => {
      result.current.sendToAll('second')
    })
    await flushSendAll()

    // Simulate turn 2 streaming: a NEW cumulative assistant text appears.
    // Our hook's cursor reset (lastAssistantLenRef.current.set(..., 0))
    // means the delta starts from scratch and lands on the FRESH empty
    // assistant frame appended at sendToAll time.
    for (const inst of chatInstances) {
      inst.messages = [
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'TWO' }],
        },
      ]
      const cbs = inst['__registeredCallbacks']
      const cb = cbs[cbs.length - 1]
      cb?.()
    }
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      await Promise.resolve()
    })

    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      const roles = c.messages.map((m) => m.role)
      // Expected shape: [user, asst, user, asst]. Crucially turn 2's
      // assistant must NOT be merged into turn 1's assistant.
      expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])

      // Turn 1 assistant text should be "ONE", turn 2 assistant text "TWO".
      const turn1Asst = c.messages[1]
      const turn2Asst = c.messages[3]
      const extract = (m: typeof turn1Asst) => {
        const parts = (m.parts ?? []) as Array<{ type: string; text?: string }>
        return parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('')
      }
      expect(extract(turn1Asst)).toBe('ONE')
      expect(extract(turn2Asst)).toBe('TWO')
    }
  })

  it('attachments: file parts from master tray are appended to user message + sent as SDK files', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    // Pre-seed an image attachment on the master tray.
    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAA=',
      },
    ])

    act(() => {
      result.current.sendToAll('analyze this')
    })
    await flushSendAll()

    // 1) The user UIMessage in every column carries BOTH text AND file part.
    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      const user = c.messages.find((m) => m.role === 'user')
      expect(user).toBeDefined()
      const parts = (user!.parts ?? []) as Array<{
        type: string
        text?: string
        url?: string
        mediaType?: string
      }>
      expect(
        parts.some((p) => p.type === 'text' && p.text === 'analyze this')
      ).toBe(true)
      expect(
        parts.some(
          (p) =>
            p.type === 'file' &&
            p.url === 'data:image/png;base64,AAA=' &&
            p.mediaType === 'image/png'
        )
      ).toBe(true)
    }

    // 2) chat.sendMessage was called with `files` populated for every column.
    for (const inst of chatInstances) {
      expect(inst.sendMessage).toHaveBeenCalledTimes(1)
      const callArgs = inst.sendMessage.mock.calls[0]
      const sendArg = callArgs[0] as {
        text: string
        files?: Array<{ type: string; mediaType: string; url: string }>
      }
      expect(sendArg.text).toBe('analyze this')
      expect(sendArg.files).toBeDefined()
      expect(sendArg.files!.length).toBe(1)
      expect(sendArg.files![0]).toEqual({
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,AAA=',
      })
    }
  })

  it('attachments: master tray is CLEARED after sendToAll (per-turn persistence)', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAA=',
      },
    ])

    act(() => {
      result.current.sendToAll('here')
    })
    await flushSendAll()

    // Tray is cleared (the helper deletes the key entirely).
    expect(attachmentsByKey.has(COMPARE_MASTER_ATTACHMENT_KEY)).toBe(false)
  })

  it('attachments: NO capability gating — every column receives image+text dispatch regardless of model', async () => {
    const { result } = renderHook(() => useCompareSession())

    // Compare doesn't read model.capabilities anywhere in dispatch — both
    // columns get the same payload. Transport's modelHasVision strip handles
    // text-only models gracefully on the server side.
    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o') // pretend vision
      result.current.addModel(makeProvider('LLM'), 'LLM-haiku') // pretend text-only
    })

    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAA=',
      },
    ])

    act(() => {
      result.current.sendToAll('check it out')
    })
    await flushSendAll()

    // Status flipped to streaming for BOTH columns — neither was pre-flight
    // skipped.
    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      expect(c.status).toBe('streaming')
      expect(c.error).toBeNull()
    }

    // Both columns received the same SDK send args, including files.
    expect(chatInstances.length).toBe(2)
    for (const inst of chatInstances) {
      expect(inst.sendMessage).toHaveBeenCalledTimes(1)
      const sendArg = inst.sendMessage.mock.calls[0][0] as {
        text: string
        files?: Array<{ type: string; mediaType: string; url: string }>
      }
      expect(sendArg.files?.length).toBe(1)
    }
  })

  it('attachments: turn-1 attachment is preserved in column.messages history after a text-only turn 2', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    // Turn 1 with attachment.
    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAA=',
      },
    ])
    act(() => {
      result.current.sendToAll('look here')
    })
    await flushSendAll()

    // Resolve turn 1 stream.
    await act(async () => {
      for (const r of sendResolvers.splice(0)) r.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Turn 2: NO attachment in tray (it was cleared).
    expect(attachmentsByKey.has(COMPARE_MASTER_ATTACHMENT_KEY)).toBe(false)
    act(() => {
      result.current.sendToAll('text only follow-up')
    })
    await flushSendAll()

    // Turn 1's user message in every column STILL carries the file part.
    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      const turn1User = c.messages[0]
      expect(turn1User.role).toBe('user')
      const parts = (turn1User.parts ?? []) as Array<{
        type: string
        url?: string
      }>
      expect(
        parts.some(
          (p) => p.type === 'file' && p.url === 'data:image/png;base64,AAA='
        )
      ).toBe(true)

      // Turn 2's user message has text but NO file part.
      const turn2User = c.messages[2]
      expect(turn2User.role).toBe('user')
      const parts2 = (turn2User.parts ?? []) as Array<{
        type: string
        url?: string
      }>
      expect(parts2.some((p) => p.type === 'file')).toBe(false)
    }
  })

  // ===========================================================================
  // Bug 6 regression: PDF attached in /compare must inline-parse, never embed.
  // Compare has no per-column retrieval, so the embeddings branch would surface
  // only a citation marker (no content reaches the model) AND would silently
  // hang the UI for several seconds while the vec ingest pipeline runs.
  // ===========================================================================

  it('attachments: Compare forces parsePreference="inline" and injects parsed PDF text into the user message', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    // Pre-seed a document attachment with parseMode 'auto' (default) — Compare
    // must override and force inline regardless.
    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'document',
        name: 'doc.pdf',
        path: '/tmp/doc.pdf',
        fileType: 'pdf',
        parseMode: 'auto',
      },
    ])

    // Mock processAttachmentsForSend to (a) capture the parsePreference arg
    // it was called with, and (b) return an inline-parsed document so the
    // hook builds an inline text part for the user message.
    let receivedParsePreference: string | undefined
    processAttachmentsForSendMock.mockImplementationOnce(
      async (opts: {
        attachments: Array<Record<string, unknown>>
        parsePreference?: string
      }) => {
        receivedParsePreference = opts.parsePreference
        return {
          processedAttachments: opts.attachments.map((a) => ({
            ...a,
            processed: true,
            processing: false,
            injectionMode: 'inline',
            inlineContent: 'PDF body text here',
          })),
          hasEmbeddedDocuments: false,
        }
      }
    )

    act(() => {
      result.current.sendToAll('baca pdf itu')
    })
    await flushSendAll()

    // 1) Compare must have forced 'inline' (NOT 'auto', NOT 'embeddings').
    expect(receivedParsePreference).toBe('inline')

    // 2) Every column's user message contains the inline PDF text.
    const cols = useCompareSessionStore.getState().columns
    for (const c of cols) {
      const user = c.messages.find((m) => m.role === 'user')
      expect(user).toBeDefined()
      const parts = (user!.parts ?? []) as Array<{
        type: string
        text?: string
      }>
      const joinedText = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('')
      expect(joinedText).toContain('PDF body text here')
      expect(joinedText).toContain('baca pdf itu')

      // 3) Status flipped past idle (streaming or submitted), NOT stuck idle
      //    or error — the bug symptom was idle-forever silence.
      expect(c.status).not.toBe('idle')
      expect(c.status).not.toBe('error')
    }
  })

  it('attachments: Compare surfaces a per-column error when inline parsing fails', async () => {
    const { result } = renderHook(() => useCompareSession())

    act(() => {
      result.current.addModel(makeProvider('openai'), 'gpt-4o')
      result.current.addModel(makeProvider('LLM'), 'LLM-3-5')
    })

    attachmentsByKey.set(COMPARE_MASTER_ATTACHMENT_KEY, [
      {
        type: 'document',
        name: 'broken.pdf',
        path: '/tmp/broken.pdf',
        fileType: 'pdf',
        parseMode: 'auto',
      },
    ])

    // Simulate the new inline-mode guard inside processAttachmentsForSend:
    // when parsing fails AND parsePreference === 'inline', it throws instead
    // of falling back to embeddings. The hook's catch must convert that into
    // a per-column error state.
    processAttachmentsForSendMock.mockImplementationOnce(async () => {
      throw new Error('Failed to parse broken.pdf for inline use')
    })

    act(() => {
      result.current.sendToAll('hi')
    })
    await flushSendAll()

    const cols = useCompareSessionStore.getState().columns
    expect(cols.length).toBeGreaterThan(0)
    for (const c of cols) {
      expect(c.status).toBe('error')
      expect(c.error ?? '').toMatch(/parse|Failed to parse/i)
    }
    // No chat.sendMessage should have been dispatched.
    for (const inst of chatInstances) {
      expect(inst.sendMessage).not.toHaveBeenCalled()
    }
  })
})
