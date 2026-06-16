/**
 * Regression test for the master-prompt auto-clear behavior on /compare.
 *
 * Bug: After clicking "Send All", the master prompt textarea retained the
 * previously-sent text, forcing users to manually delete it before composing
 * the next prompt. This test locks the fix: the route's `handleSendAll` must
 * call `sendToAll(masterPrompt)` first, then clear the prompt via
 * `setMasterPrompt('')` — mirroring /threads' ChatInput post-send clear.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// --- Mocks (must be hoisted above the import of the route module) ---------
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'model' in opts) return `${key}:${opts.model as string}`
      if (opts && 'path' in opts) return `${key}:${opts.path as string}`
      return key
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}))

const sendToAllMock = vi.fn()
const setMasterPromptMock = vi.fn()

// Stateful hook mock: setMasterPrompt mutates `masterPrompt` so the controlled
// textarea re-renders empty, just like the real Zustand store would.
let masterPrompt = 'hello world'

vi.mock('@/hooks/useCompareSession', () => ({
  useCompareSession: () => ({
    columns: [
      {
        id: 'c1',
        provider: { provider: 'openai' },
        modelId: 'gpt-4o',
        status: 'idle',
        messages: [],
        metrics: {},
      },
      {
        id: 'c2',
        provider: { provider: 'anthropic' },
        modelId: 'claude-3-5-sonnet',
        status: 'idle',
        messages: [],
        metrics: {},
      },
    ],
    masterPrompt,
    isAnyStreaming: false,
    canSend: true,
    setMasterPrompt: (v: string) => {
      setMasterPromptMock(v)
      masterPrompt = v
    },
    addModel: vi.fn(),
    removeModel: vi.fn(),
    sendToAll: sendToAllMock,
    stopColumn: vi.fn(),
    stopAll: vi.fn(),
    clearAll: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector?: (s: { providers: unknown[] }) => unknown) => {
    const state = { providers: [] }
    return selector ? selector(state) : state
  },
  default: () => ({ providers: [] }),
}))

vi.mock('@/lib/compare-export', () => ({
  exportCompareToFile: vi.fn().mockResolvedValue({ ok: true, path: 'x' }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: { compare: '/compare' },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
}))

// --- System under test ----------------------------------------------------
import { ComparePage } from '@/routes/compare'

describe('Compare route — master prompt auto-clear on Send All', () => {
  it('clears the master prompt after dispatching sendToAll', () => {
    masterPrompt = 'hello world'
    sendToAllMock.mockClear()
    setMasterPromptMock.mockClear()

    const { getByTestId } = render(<ComparePage />)
    const sendBtn = getByTestId('compare-send-all')

    fireEvent.click(sendBtn)

    // sendToAll must be called with the ORIGINAL prompt, BEFORE the clear,
    // so the dispatched message keeps the user's text.
    expect(sendToAllMock).toHaveBeenCalledTimes(1)
    expect(sendToAllMock).toHaveBeenCalledWith('hello world')

    // setMasterPrompt('') must be called to reset the controlled textarea.
    expect(setMasterPromptMock).toHaveBeenCalledWith('')

    // Order check: sendToAll fires before setMasterPrompt(''), so the user's
    // text is dispatched intact — never cleared mid-flight.
    const sendOrder = sendToAllMock.mock.invocationCallOrder[0]
    const clearOrder = setMasterPromptMock.mock.invocationCallOrder.find(
      (_o, i) => setMasterPromptMock.mock.calls[i][0] === ''
    )
    expect(clearOrder).toBeDefined()
    expect(sendOrder).toBeLessThan(clearOrder as number)
  })
})
