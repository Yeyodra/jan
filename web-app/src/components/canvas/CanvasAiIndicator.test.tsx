/**
 * CanvasAiIndicator — unit tests (T19, Wave 5)
 *
 * Behavior contract under test:
 *   - Hidden when state ∈ {'idle', 'error'}
 *   - Visible when state ∈ {'spawning', 'awaiting-approval', 'drawing'}
 *   - Wrapper carries role="status" + aria-live="polite"
 *   - Visible label is the literal string "AI is drawing…"
 *   - Pointer events are disabled on the overlay (must not block canvas)
 *   - Render across the 5 OrchestratorState values commits within a single
 *     React frame budget (16ms preferred; 50ms ceiling — see decisions.md)
 */
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { CanvasAiIndicator } from './CanvasAiIndicator'
import type { OrchestratorState } from '@/lib/canvas-mcp-orchestrator/types'

const VISIBLE_STATES: OrchestratorState[] = [
  'spawning',
  'awaiting-approval',
  'drawing',
]
const HIDDEN_STATES: OrchestratorState[] = ['idle', 'error']

const INDICATOR_TEXT = 'AI is drawing…'

describe('CanvasAiIndicator (visibility)', () => {
  it.each(HIDDEN_STATES)(
    'renders nothing when state="%s"',
    (state) => {
      const { container } = render(<CanvasAiIndicator state={state} />)
      // Wrapper is suppressed entirely (returns null) — no DOM emitted.
      expect(container.firstChild).toBeNull()
      expect(screen.queryByText(INDICATOR_TEXT)).not.toBeInTheDocument()
      cleanup()
    },
  )

  it.each(VISIBLE_STATES)(
    'renders spinner + "AI is drawing…" when state="%s"',
    (state) => {
      render(<CanvasAiIndicator state={state} />)
      expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()
      // role=status surfaces the live-region for assistive tech
      expect(screen.getByRole('status')).toBeInTheDocument()
      cleanup()
    },
  )
})

describe('CanvasAiIndicator (accessibility)', () => {
  it('exposes role="status" and aria-live="polite" on the wrapper', () => {
    render(<CanvasAiIndicator state="drawing" />)
    const wrapper = screen.getByRole('status')
    expect(wrapper).toHaveAttribute('aria-live', 'polite')
  })

  it('disables pointer events on the overlay (must not block canvas)', () => {
    render(<CanvasAiIndicator state="drawing" />)
    const wrapper = screen.getByRole('status')
    // Class-based assertion: Tailwind's pointer-events-none must be present
    // so the overlay never intercepts canvas mouse/touch events.
    expect(wrapper.className).toMatch(/pointer-events-none/)
  })
})

describe('CanvasAiIndicator (state transitions)', () => {
  it('auto-hides on transition drawing → idle', () => {
    const { rerender, container } = render(
      <CanvasAiIndicator state="drawing" />,
    )
    expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()

    rerender(<CanvasAiIndicator state="idle" />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(INDICATOR_TEXT)).not.toBeInTheDocument()
  })

  it('auto-hides on transition drawing → error', () => {
    const { rerender, container } = render(
      <CanvasAiIndicator state="drawing" />,
    )
    expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()

    rerender(<CanvasAiIndicator state="error" />)
    expect(container.firstChild).toBeNull()
  })

  it('appears on transition idle → spawning (cold-spawn entry)', () => {
    const { rerender } = render(<CanvasAiIndicator state="idle" />)
    expect(screen.queryByText(INDICATOR_TEXT)).not.toBeInTheDocument()

    rerender(<CanvasAiIndicator state="spawning" />)
    expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()
  })
})

describe('CanvasAiIndicator (progress counter)', () => {
  it('renders "AI is drawing…" without counter when progress is undefined', () => {
    render(<CanvasAiIndicator state="drawing" />)
    expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-ai-indicator-counter')).not.toBeInTheDocument()
    cleanup()
  })

  it('renders "AI is drawing… (1/5)" when progress={current:1,total:5}', () => {
    render(<CanvasAiIndicator state="drawing" progress={{ current: 1, total: 5 }} />)
    expect(screen.getByText(INDICATOR_TEXT)).toBeInTheDocument()
    expect(screen.getByTestId('canvas-ai-indicator-counter')).toHaveTextContent('(1/5)')
    cleanup()
  })

  it('counter span has data-testid="canvas-ai-indicator-counter"', () => {
    render(<CanvasAiIndicator state="drawing" progress={{ current: 3, total: 5 }} />)
    const counter = screen.getByTestId('canvas-ai-indicator-counter')
    expect(counter).toBeInTheDocument()
    expect(counter.tagName).toBe('SPAN')
    cleanup()
  })
})

describe('CanvasAiIndicator (render performance)', () => {
  /**
   * Wall-clock render-budget gate. Plan §1972 calls for 16ms (single React
   * frame). On bun/jsdom this is occasionally jittery, so we relax to a
   * 50ms ceiling (documented in decisions.md). This is a smoke gate, not
   * a hard correctness contract — we mostly want to catch accidental
   * import-time blocking work or sync layout in the component body.
   */
  const FRAME_BUDGET_MS = 50

  const ALL_STATES: OrchestratorState[] = [
    'idle',
    'spawning',
    'awaiting-approval',
    'drawing',
    'error',
  ]

  it.each(ALL_STATES)(
    'renders within %s ms when state="%s"',
    (state) => {
      const t0 = performance.now()
      render(<CanvasAiIndicator state={state} />)
      const dt = performance.now() - t0
      expect(dt).toBeLessThan(FRAME_BUDGET_MS)
      cleanup()
    },
  )
})
