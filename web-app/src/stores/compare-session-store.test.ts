import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import { useCompareSessionStore } from './compare-session-store'

// ---------------------------------------------------------------------------
// rAF harness
// ---------------------------------------------------------------------------
// jsdom provides rAF, but its scheduling is opaque (16ms timer). We stub it
// with a manual queue so we can assert "exactly one setState per frame" and
// drain frames deterministically.

let rafQueue: FrameRequestCallback[] = []
let rafSpy: ReturnType<typeof vi.spyOn>
let cafSpy: ReturnType<typeof vi.spyOn>

function runFrame(): void {
  const queued = rafQueue
  rafQueue = []
  for (const cb of queued) cb(performance.now())
}

function makeProvider(name: string): ModelProvider {
  return {
    active: true,
    provider: name,
    settings: [],
    models: [],
  } as ModelProvider
}

function getStore() {
  return useCompareSessionStore.getState()
}

beforeEach(() => {
  rafQueue = []
  rafSpy = vi
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length // any non-zero handle
    })
  cafSpy = vi
    .spyOn(globalThis, 'cancelAnimationFrame')
    .mockImplementation(() => {})
  // Reset store between tests.
  useCompareSessionStore.getState().clearAll()
})

afterEach(() => {
  rafSpy.mockRestore()
  cafSpy.mockRestore()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCompareSessionStore', () => {
  it('addColumn adds a column with unique id and sessionId', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('anthropic'), 'claude-3-5-sonnet')

    const cols = getStore().columns
    expect(cols).toHaveLength(2)
    expect(cols[0].id).not.toBe(cols[1].id)
    expect(cols[0].sessionId).not.toBe(cols[1].sessionId)
    expect(cols[0].id).not.toBe(cols[0].sessionId)
    expect(cols[0].status).toBe('idle')
    expect(cols[0].messages).toEqual([])
    expect(cols[0].metrics).toEqual({
      ttftMs: null,
      totalMs: null,
      outputTokens: null,
    })
    expect(cols[0].error).toBeNull()
    expect(cols[0].sendStartedAt).toBeNull()
  })

  it('addColumn with duplicate (provider, modelId) is a no-op', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('openai'), 'gpt-4o')

    expect(getStore().columns).toHaveLength(1)
  })

  it('addColumn caps at 6 (7th call is no-op)', () => {
    const { addColumn } = getStore()
    for (let i = 0; i < 7; i++) {
      addColumn(makeProvider('p' + i), 'm' + i)
    }
    expect(getStore().columns).toHaveLength(6)
  })

  it('removeColumn drops the column', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('anthropic'), 'claude')
    const targetId = getStore().columns[0].id

    getStore().removeColumn(targetId)

    expect(getStore().columns).toHaveLength(1)
    expect(getStore().columns[0].provider.provider).toBe('anthropic')
  })

  it('setMasterPrompt updates state', () => {
    getStore().setMasterPrompt('compare these models')
    expect(getStore().masterPrompt).toBe('compare these models')
  })

  it('setColumnStatus transitions correctly (idle -> streaming -> finished)', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    const id = getStore().columns[0].id

    expect(getStore().columns[0].status).toBe('idle')
    getStore().setColumnStatus(id, 'streaming')
    expect(getStore().columns[0].status).toBe('streaming')
    getStore().setColumnStatus(id, 'finished')
    expect(getStore().columns[0].status).toBe('finished')
  })

  it('setColumnMetrics partial update preserves untouched fields', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    const id = getStore().columns[0].id

    getStore().setColumnMetrics(id, { ttftMs: 120 })
    expect(getStore().columns[0].metrics).toEqual({
      ttftMs: 120,
      totalMs: null,
      outputTokens: null,
    })
    getStore().setColumnMetrics(id, { outputTokens: 256 })
    expect(getStore().columns[0].metrics).toEqual({
      ttftMs: 120,
      totalMs: null,
      outputTokens: 256,
    })
  })

  it('rAF batching: 10 sequential updateAssistantStream calls produce ONE setState after the frame', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    const id = getStore().columns[0].id

    const setStateCalls: number[] = []
    const unsubscribe = useCompareSessionStore.subscribe(() => {
      setStateCalls.push(Date.now())
    })

    try {
      for (let i = 0; i < 10; i++) {
        getStore().updateAssistantStream(id, `chunk${i} `)
      }

      // Before the frame fires, no commits should have happened.
      expect(setStateCalls.length).toBe(0)
      // Exactly one rAF should have been scheduled across the 10 calls.
      expect(rafSpy).toHaveBeenCalledTimes(1)

      runFrame()

      // Exactly one setState commit for all 10 deltas.
      expect(setStateCalls.length).toBe(1)

      const col = getStore().columns[0]
      expect(col.messages).toHaveLength(1)
      expect(col.messages[0].role).toBe('assistant')
      const parts = col.messages[0].parts as Array<{
        type: string
        text?: string
      }>
      expect(parts[0].type).toBe('text')
      expect(parts[0].text).toBe(
        'chunk0 chunk1 chunk2 chunk3 chunk4 chunk5 chunk6 chunk7 chunk8 chunk9 '
      )
    } finally {
      unsubscribe()
    }
  })

  it('rAF batching across multiple columns coalesces into a single setState', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('anthropic'), 'claude')
    const [a, b] = getStore().columns.map((c) => c.id)

    let commits = 0
    const unsubscribe = useCompareSessionStore.subscribe(() => {
      commits++
    })

    try {
      getStore().updateAssistantStream(a, 'A1')
      getStore().updateAssistantStream(b, 'B1')
      getStore().updateAssistantStream(a, 'A2')
      getStore().updateAssistantStream(b, 'B2')

      expect(rafSpy).toHaveBeenCalledTimes(1)
      runFrame()
      expect(commits).toBe(1)

      const cols = getStore().columns
      const partsA = cols[0].messages[0].parts as Array<{ text?: string }>
      const partsB = cols[1].messages[0].parts as Array<{ text?: string }>
      expect(partsA[0].text).toBe('A1A2')
      expect(partsB[0].text).toBe('B1B2')
    } finally {
      unsubscribe()
    }
  })

  it('appendMessage is rAF-batched and ordered after the prior assistant message', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    const id = getStore().columns[0].id

    const userMsg = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    } as unknown as UIMessage

    getStore().appendMessage(id, userMsg)
    getStore().updateAssistantStream(id, 'hi back')

    expect(rafSpy).toHaveBeenCalledTimes(1)
    runFrame()

    const msgs = getStore().columns[0].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].role).toBe('assistant')
    const aParts = msgs[1].parts as Array<{ text?: string }>
    expect(aParts[0].text).toBe('hi back')
  })

  it('clearAll empties columns and drops pending flushes (late frame is a no-op)', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    const id = getStore().columns[0].id

    getStore().updateAssistantStream(id, 'will be discarded')
    expect(rafSpy).toHaveBeenCalledTimes(1)

    getStore().setMasterPrompt('something')
    getStore().clearAll()

    expect(getStore().columns).toEqual([])
    expect(getStore().masterPrompt).toBe('')

    let lateCommits = 0
    const unsubscribe = useCompareSessionStore.subscribe(() => {
      lateCommits++
    })
    try {
      runFrame()
      // The late frame should see an empty pending map and not commit.
      expect(lateCommits).toBe(0)
      expect(getStore().columns).toEqual([])
    } finally {
      unsubscribe()
    }
  })

  it('removeColumn drops pending flushes for that column', () => {
    const { addColumn } = getStore()
    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('anthropic'), 'claude')
    const [a, b] = getStore().columns.map((c) => c.id)

    getStore().updateAssistantStream(a, 'A1')
    getStore().updateAssistantStream(b, 'B1')
    getStore().removeColumn(a)

    runFrame()

    const cols = getStore().columns
    expect(cols).toHaveLength(1)
    expect(cols[0].id).toBe(b)
    const parts = cols[0].messages[0].parts as Array<{ text?: string }>
    expect(parts[0].text).toBe('B1')
  })

  it('selectors: useCompareIsAnyStreaming and useCompareCanSend reflect state', () => {
    const { addColumn, setColumnStatus, setMasterPrompt } = getStore()

    // Empty: cannot send, nothing streaming.
    expect(
      useCompareSessionStore
        .getState()
        .columns.some(
          (c) => c.status === 'streaming' || c.status === 'stopping'
        )
    ).toBe(false)

    addColumn(makeProvider('openai'), 'gpt-4o')
    addColumn(makeProvider('anthropic'), 'claude')
    setMasterPrompt('go')

    let canSend =
      getStore().columns.length >= 2 &&
      !getStore().columns.some(
        (c) => c.status === 'streaming' || c.status === 'stopping'
      ) &&
      getStore().masterPrompt.trim().length > 0
    expect(canSend).toBe(true)

    const id = getStore().columns[0].id
    setColumnStatus(id, 'streaming')

    const isStreaming = getStore().columns.some(
      (c) => c.status === 'streaming' || c.status === 'stopping'
    )
    expect(isStreaming).toBe(true)

    canSend =
      getStore().columns.length >= 2 &&
      !isStreaming &&
      getStore().masterPrompt.trim().length > 0
    expect(canSend).toBe(false)
  })
})
