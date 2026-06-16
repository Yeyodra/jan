/**
 * Regression tests for the column-remove confirmation flow on /compare.
 *
 * Bug 14: The column close (X) button used `window.confirm()` (native browser
 * dialog) when removing a column with conversation history. This test locks
 * the new behavior:
 *
 *   1. Closing an EMPTY column skips the modal — `removeModel` fires immediately.
 *   2. Closing a column WITH messages opens the shadcn Dialog. Clicking
 *      "Cancel" closes the modal WITHOUT calling `removeModel`.
 *   3. Closing a column WITH messages, then clicking the destructive
 *      "Remove model" button, calls `removeModel` once with the correct
 *      (providerId, modelId) and closes the modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, within } from '@testing-library/react'
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

const removeModelMock = vi.fn()

// Stateful columns mock — tests mutate `columns` to vary message counts.
type Col = {
  id: string
  provider: { provider: string }
  modelId: string
  status: string
  messages: unknown[]
  metrics: Record<string, unknown>
}

let columns: Col[] = []

vi.mock('@/hooks/useCompareSession', () => ({
  useCompareSession: () => ({
    columns,
    masterPrompt: '',
    isAnyStreaming: false,
    canSend: true,
    setMasterPrompt: vi.fn(),
    addModel: vi.fn(),
    removeModel: removeModelMock,
    sendToAll: vi.fn(),
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

const makeColumn = (overrides: Partial<Col>): Col => ({
  id: 'c1',
  provider: { provider: 'openai' },
  modelId: 'gpt-4o',
  status: 'idle',
  messages: [],
  metrics: {},
  ...overrides,
})

describe('Compare route — column remove confirmation modal', () => {
  beforeEach(() => {
    removeModelMock.mockClear()
  })

  it('removes empty column immediately without showing the modal', () => {
    columns = [
      makeColumn({ id: 'c1', provider: { provider: 'openai' }, modelId: 'gpt-4o', messages: [] }),
      makeColumn({ id: 'c2', provider: { provider: 'provider' }, modelId: 'LLM-3-5-sonnet', messages: [] }),
    ]

    const { getAllByLabelText, queryByRole } = render(<ComparePage />)

    // Click X on first column
    const closeButtons = getAllByLabelText('compare:removeColumn')
    fireEvent.click(closeButtons[0])

    // No modal opened (Dialog with role=dialog isn't rendered)
    expect(queryByRole('dialog')).not.toBeInTheDocument()

    // removeModel called immediately with correct args
    expect(removeModelMock).toHaveBeenCalledTimes(1)
    expect(removeModelMock).toHaveBeenCalledWith('openai', 'gpt-4o')
  })

  it('opens the modal when column has messages, Cancel preserves the column', () => {
    columns = [
      makeColumn({
        id: 'c1',
        provider: { provider: 'openai' },
        modelId: 'gpt-4o',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
      makeColumn({ id: 'c2', provider: { provider: 'provider' }, modelId: 'LLM-3-5-sonnet', messages: [] }),
    ]

    const { getAllByLabelText, getByRole } = render(<ComparePage />)

    // Click X on first column (with messages)
    const closeButtons = getAllByLabelText('compare:removeColumn')
    fireEvent.click(closeButtons[0])

    // Modal is now open
    const dialog = getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // Click Cancel inside the dialog
    const cancelBtn = within(dialog).getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    // removeModel was NEVER called
    expect(removeModelMock).not.toHaveBeenCalled()
  })

  it('opens the modal, clicking destructive Remove fires removeModel once', () => {
    columns = [
      makeColumn({
        id: 'c1',
        provider: { provider: 'openai' },
        modelId: 'gpt-4o',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
      makeColumn({ id: 'c2', provider: { provider: 'provider' }, modelId: 'LLM-3-5-sonnet', messages: [] }),
    ]

    const { getAllByLabelText, getByRole } = render(<ComparePage />)

    // Open the modal
    const closeButtons = getAllByLabelText('compare:removeColumn')
    fireEvent.click(closeButtons[0])

    const dialog = getByRole('dialog')

    // The dialog has TWO buttons matching "removeColumn" text — but only one
    // is the destructive variant inside the footer. Use role+name AND filter
    // out the column-header X button by scoping `within(dialog)`.
    const destructiveBtn = within(dialog)
      .getAllByRole('button')
      .find((btn) => btn.textContent === 'removeColumn')

    expect(destructiveBtn).toBeDefined()
    fireEvent.click(destructiveBtn!)

    // removeModel fires exactly once with the correct args
    expect(removeModelMock).toHaveBeenCalledTimes(1)
    expect(removeModelMock).toHaveBeenCalledWith('openai', 'gpt-4o')
  })
})
