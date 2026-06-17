/**
 * CanvasManualEditLockBanner — unit tests (T22, Wave 5)
 *
 * Behavior contract under test (plan §2186):
 *   - Renders nothing when isLocked === false
 *   - Renders the banner text "AI is drawing — manual edits paused"
 *     when isLocked === true
 *   - Wrapper carries role="status" + aria-live="polite"
 *   - Wrapper carries `pointer-events-none` so it never blocks the canvas
 *   - Banner POSITION differs from `CanvasAiIndicator` (top-right pill)
 *     so the two can render simultaneously without stacking — see
 *     decisions.md.
 *
 * Pure presentational; T20 wires it to the orchestrator's lock state via
 * `subscribeManualEditLock`.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { CanvasManualEditLockBanner } from './CanvasManualEditLockBanner'

const BANNER_TEXT = 'AI is drawing — manual edits paused'

describe('CanvasManualEditLockBanner — visibility', () => {
  it('renders nothing when isLocked=false', () => {
    const { container } = render(
      <CanvasManualEditLockBanner isLocked={false} />,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    cleanup()
  })

  it('renders the banner text when isLocked=true', () => {
    render(<CanvasManualEditLockBanner isLocked />)
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()
    cleanup()
  })
})

describe('CanvasManualEditLockBanner — accessibility', () => {
  it('exposes role="status" and aria-live="polite" on the wrapper', () => {
    render(<CanvasManualEditLockBanner isLocked />)
    const wrapper = screen.getByRole('status')
    expect(wrapper).toHaveAttribute('aria-live', 'polite')
    cleanup()
  })

  it('disables pointer events on the wrapper (must not block canvas)', () => {
    render(<CanvasManualEditLockBanner isLocked />)
    const wrapper = screen.getByRole('status')
    expect(wrapper.className).toMatch(/pointer-events-none/)
    cleanup()
  })
})

describe('CanvasManualEditLockBanner — composition', () => {
  it('accepts a className override', () => {
    render(
      <CanvasManualEditLockBanner isLocked className="custom-banner-class" />,
    )
    const wrapper = screen.getByRole('status')
    expect(wrapper.className).toMatch(/custom-banner-class/)
    cleanup()
  })

  it('toggles between visible/hidden across re-renders', () => {
    const { rerender, container } = render(
      <CanvasManualEditLockBanner isLocked={false} />,
    )
    expect(container.firstChild).toBeNull()

    rerender(<CanvasManualEditLockBanner isLocked />)
    expect(screen.getByText(BANNER_TEXT)).toBeInTheDocument()

    rerender(<CanvasManualEditLockBanner isLocked={false} />)
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument()
    cleanup()
  })
})
