import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  CanvasErrorBoundary,
  CanvasRouteErrorComponent,
} from '../CanvasErrorBoundary'

// i18n passthrough — return key as-is
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// `useNavigate` from TanStack Router needs to be mocked because the boundary's
// fallback UI calls it for the "Back to canvas list" button.
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

// Animated icon stub (lottie/framer not jsdom-friendly)
vi.mock('@/components/animated-icon/canvas', () => ({
  CanvasIcon: () => <span data-testid="canvas-icon" />,
}))

// `route` constants — use a stable shape
vi.mock('@/constants/routes', () => ({
  route: { canvas: '/canvas' },
}))

function Boom(): JSX.Element {
  throw new Error('boom!')
}

describe('CanvasErrorBoundary (class component)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // React logs caught render errors to console.error — silence for clean test output
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders children when no error is thrown', () => {
    render(
      <CanvasErrorBoundary>
        <div data-testid="child">ok</div>
      </CanvasErrorBoundary>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('renders the fallback UI when a child throws', () => {
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    )
    expect(screen.getByTestId('canvas-error-boundary')).toBeInTheDocument()
    expect(screen.getByText('errors.boundaryTitle')).toBeInTheDocument()
    expect(screen.getByText('errors.boundaryDescription')).toBeInTheDocument()
  })

  it('surfaces the error message in the fallback', () => {
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    )
    expect(screen.getByText('boom!')).toBeInTheDocument()
  })

  it('logs the caught error to console.error', () => {
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    )
    // boundary calls console.error('[CanvasErrorBoundary] caught render error:', error, info)
    const calls = errorSpy.mock.calls.map((c) => String(c[0] ?? ''))
    expect(
      calls.some((s) => s.includes('[CanvasErrorBoundary]')),
    ).toBe(true)
  })

  it('exposes a "Try again" button that resets the boundary', async () => {
    const user = userEvent.setup()
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    )
    const retry = screen.getByTestId('canvas-error-retry')
    expect(retry).toHaveTextContent('errors.tryAgain')
    // Clicking retry resets state — the child throws again immediately, so the
    // fallback should still be visible. We assert the click does not crash and
    // the boundary still renders its fallback (state was reset, then re-thrown).
    await user.click(retry)
    expect(screen.getByTestId('canvas-error-boundary')).toBeInTheDocument()
  })

  it('navigates to /canvas when the "Back to list" button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <CanvasErrorBoundary>
        <Boom />
      </CanvasErrorBoundary>,
    )
    await user.click(screen.getByTestId('canvas-error-back-to-list'))
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/canvas' })
  })
})

describe('CanvasRouteErrorComponent (router adapter)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders the fallback UI for a router-supplied Error', () => {
    render(<CanvasRouteErrorComponent error={new Error('route boom')} />)
    expect(screen.getByTestId('canvas-error-boundary')).toBeInTheDocument()
    expect(screen.getByText('route boom')).toBeInTheDocument()
  })

  it('wires reset to the retry button when provided', async () => {
    const user = userEvent.setup()
    const reset = vi.fn()
    render(
      <CanvasRouteErrorComponent error={new Error('x')} reset={reset} />,
    )
    const retry = screen.getByTestId('canvas-error-retry')
    await user.click(retry)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not render a retry button when reset is omitted', () => {
    render(<CanvasRouteErrorComponent error={new Error('x')} />)
    expect(screen.queryByTestId('canvas-error-retry')).toBeNull()
  })

  it('logs the error to console.error', () => {
    render(<CanvasRouteErrorComponent error={new Error('logged')} />)
    const calls = errorSpy.mock.calls.map((c) => String(c[0] ?? ''))
    expect(calls.some((s) => s.includes('[Canvas route]'))).toBe(true)
  })
})
