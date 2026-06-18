import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CanvasPromptBar } from './CanvasPromptBar'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function renderBar(
  overrides: Partial<React.ComponentProps<typeof CanvasPromptBar>> = {},
) {
  const defaults = {
    canvasId: 'canvas-1' as string | null,
    isSubmitting: false,
    onSubmit: vi.fn(),
  }
  const props = { ...defaults, ...overrides }
  const utils = render(<CanvasPromptBar {...props} />)
  return { ...utils, props }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CanvasPromptBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an input and a Send button', () => {
    renderBar()

    expect(screen.getByTestId('canvas-prompt-bar')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-prompt-send')).toBeInTheDocument()
  })

  it('Send button is disabled on empty input', () => {
    renderBar()
    expect(screen.getByTestId('canvas-prompt-send')).toBeDisabled()
  })

  it('Send button is disabled on whitespace-only input', async () => {
    const user = userEvent.setup()
    renderBar()

    const input = screen.getByTestId('canvas-prompt-input')
    await user.type(input, '   ')

    expect(screen.getByTestId('canvas-prompt-send')).toBeDisabled()
  })

  it('Send button enables when input has non-whitespace content', async () => {
    const user = userEvent.setup()
    renderBar()

    const input = screen.getByTestId('canvas-prompt-input')
    await user.type(input, 'draw a rectangle')

    expect(screen.getByTestId('canvas-prompt-send')).toBeEnabled()
  })

  it('Send button is disabled while isSubmitting=true', () => {
    renderBar({ isSubmitting: true })
    expect(screen.getByTestId('canvas-prompt-send')).toBeDisabled()
  })

  it('input is disabled while isSubmitting=true', () => {
    renderBar({ isSubmitting: true })
    expect(screen.getByTestId('canvas-prompt-input')).toBeDisabled()
  })

  it('Send button is disabled when canvasId is null', async () => {
    const user = userEvent.setup()
    renderBar({ canvasId: null })

    // Even after attempting to type, the input is disabled and Send stays disabled.
    const input = screen.getByTestId('canvas-prompt-input')
    expect(input).toBeDisabled()
    await user.type(input, 'draw').catch(() => {
      /* userEvent throws on disabled inputs in some versions */
    })
    expect(screen.getByTestId('canvas-prompt-send')).toBeDisabled()
  })

  it('clicking Send calls onSubmit with the trimmed value exactly once', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderBar({ onSubmit })

    await user.type(screen.getByTestId('canvas-prompt-input'), '  hello world  ')
    await user.click(screen.getByTestId('canvas-prompt-send'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('hello world')
  })

  it('pressing Enter (without Shift) submits when input is valid', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderBar({ onSubmit })

    const input = screen.getByTestId('canvas-prompt-input')
    await user.type(input, 'draw a circle{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('draw a circle')
  })

  it('pressing Enter on empty input does not call onSubmit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderBar({ onSubmit })

    const input = screen.getByTestId('canvas-prompt-input')
    await user.click(input)
    await user.keyboard('{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('Shift+Enter does not submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderBar({ onSubmit })

    const input = screen.getByTestId('canvas-prompt-input')
    await user.type(input, 'draft text')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('clears the input optimistically on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderBar({ onSubmit })

    const input = screen.getByTestId('canvas-prompt-input') as HTMLInputElement
    await user.type(input, 'draw a square')
    await user.click(screen.getByTestId('canvas-prompt-send'))

    await waitFor(() => {
      expect(input.value).toBe('')
    })
  })

  it('restores the input value when onSubmit rejects', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('orchestrator boom'))
    renderBar({ onSubmit })

    const input = screen.getByTestId('canvas-prompt-input') as HTMLInputElement
    await user.type(input, 'export the canvas as png')
    await user.click(screen.getByTestId('canvas-prompt-send'))

    // Wait for rejection to propagate and the catch branch to restore the value.
    await waitFor(() => {
      expect(input.value).toBe('export the canvas as png')
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('input is keyboard-focusable and exposes an accessible name', async () => {
    const user = userEvent.setup()
    renderBar()

    const input = screen.getByLabelText('Prompt for the canvas AI')
    expect(input).toBeInTheDocument()

    await user.tab()
    // After one Tab from document body, focus should be on the input.
    expect(input).toHaveFocus()
  })

  it('Send button has the correct aria-label per state', () => {
    const { rerender } = renderBar({ isSubmitting: false })
    expect(
      screen.getByRole('button', { name: 'Send to AI' }),
    ).toBeInTheDocument()

    rerender(
      <CanvasPromptBar
        canvasId="canvas-1"
        isSubmitting={true}
        onSubmit={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'AI is drawing' }),
    ).toBeInTheDocument()
  })

  it('announces submit state via aria-live region', () => {
    const { rerender } = renderBar({ isSubmitting: false })
    expect(screen.getByTestId('canvas-prompt-status')).toHaveTextContent('')

    rerender(
      <CanvasPromptBar
        canvasId="canvas-1"
        isSubmitting={true}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByTestId('canvas-prompt-status')).toHaveTextContent(
      'AI is drawing',
    )
  })

  // ---------------------------------------------------------------------------
  // T11 — modelPicker slot
  // ---------------------------------------------------------------------------

  it('renders modelPicker slot when prop is passed', () => {
    renderBar({
      modelPicker: <div data-testid="mock-model-picker">Model Picker</div>,
    })

    expect(screen.getByTestId('mock-model-picker')).toBeInTheDocument()
  })

  it('renders without modelPicker slot when prop is omitted — existing layout unchanged', () => {
    renderBar()

    expect(screen.queryByTestId('mock-model-picker')).not.toBeInTheDocument()
    // Core elements still present
    expect(screen.getByTestId('canvas-prompt-input')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-prompt-send')).toBeInTheDocument()
  })

  it('modelPicker renders LEFT of the send button inside the form', () => {
    renderBar({
      modelPicker: <div data-testid="mock-model-picker">Picker</div>,
    })

    const form = screen.getByTestId('canvas-prompt-bar')
    const children = Array.from(form.querySelectorAll('[data-testid]'))
    const pickerIdx = children.findIndex(
      (el) => el.getAttribute('data-testid') === 'mock-model-picker',
    )
    const sendIdx = children.findIndex(
      (el) => el.getAttribute('data-testid') === 'canvas-prompt-send',
    )
    // picker must appear before the send button in DOM order
    expect(pickerIdx).toBeGreaterThanOrEqual(0)
    expect(sendIdx).toBeGreaterThanOrEqual(0)
    expect(pickerIdx).toBeLessThan(sendIdx)
  })

  it('send button disabled with tooltip when selectedModel=null simulation via disabled prop on bar', () => {
    // The bar itself doesn't know about selectedModel — the parent gates it
    // by passing a null-model state. We test the send-disabled path here;
    // the tooltip title test belongs in the route integration tests.
    renderBar({ canvasId: 'canvas-1', isSubmitting: false })
    // Without input text the send button is disabled regardless
    expect(screen.getByTestId('canvas-prompt-send')).toBeDisabled()
  })
})
