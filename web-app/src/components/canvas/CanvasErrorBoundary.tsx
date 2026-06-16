/**
 * CanvasErrorBoundary — friendly fallback UI for runtime errors raised inside
 * the canvas routes (e.g. an Excalidraw-thrown render error, a corrupted
 * scene snapshot, OOM during PNG export).
 *
 * Two consumption shapes:
 *   1. As a React class boundary — `<CanvasErrorBoundary>{children}</...>`.
 *      Used to wrap arbitrary subtrees (e.g. just the editor surface).
 *   2. As a route-level `errorComponent` — TanStack Router calls this with
 *      `{ error, reset }` when a render throws inside the route. Use the
 *      `<CanvasRouteErrorComponent>` re-export for that wiring; it forwards
 *      the same `<CanvasErrorMessage>` UI without spinning up another class
 *      boundary (the router already provides one).
 *
 * UI contract (kept stable for QA — see `data-testid="canvas-error-boundary"`):
 *   - Title + description copy comes from `canvas:errors.boundaryTitle/...`.
 *   - "Try again" attempts a soft recovery by re-rendering / resetting
 *     router state (does NOT touch persisted canvas data — see T15/T17).
 *   - "Back to canvas list" routes the user to `/canvas` so the app can
 *     never get stuck on a broken detail screen.
 *
 * What this component does NOT do:
 *   - It does NOT mutate or auto-delete the failing canvas (data-loss risk —
 *     the plan explicitly forbids this).
 *   - It does NOT swallow the error; we always `console.error` so the dev
 *     console still surfaces the original stack.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { CanvasIcon } from '@/components/animated-icon/canvas'

// ---------------------------------------------------------------------------
// Shared fallback UI
// ---------------------------------------------------------------------------

interface CanvasErrorMessageProps {
  /** Optional error to surface below the description (dev affordance). */
  error?: unknown
  /** Soft-recovery hook — re-renders the subtree without navigating away. */
  onRetry?: () => void
}

/**
 * Centered, route-friendly fallback shown both by the class boundary and the
 * TanStack Router `errorComponent`. Pure presentational — keeps the routing
 * decisions in the parents.
 */
function CanvasErrorMessage({ error, onRetry }: CanvasErrorMessageProps) {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()

  return (
    <div
      data-testid="canvas-error-boundary"
      role="alert"
      className="flex h-full w-full flex-col items-center justify-center gap-6 px-6 py-16 text-center"
    >
      <div className="flex size-20 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <CanvasIcon size={48} />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-lg font-semibold text-foreground">
          {t('errors.boundaryTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('errors.boundaryDescription')}
        </p>
        {error instanceof Error && error.message ? (
          <p className="mt-2 break-all rounded bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {error.message}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button
            type="button"
            onClick={onRetry}
            data-testid="canvas-error-retry"
          >
            {t('errors.tryAgain')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: route.canvas })}
          data-testid="canvas-error-back-to-list"
        >
          {t('errors.backToList')}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Class boundary — wraps arbitrary children
// ---------------------------------------------------------------------------

interface CanvasErrorBoundaryProps {
  children: ReactNode
}

interface CanvasErrorBoundaryState {
  error: Error | null
}

/**
 * Class component is required — React still has no hook equivalent for
 * `componentDidCatch` / `getDerivedStateFromError`.
 */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always surface the real stack to the dev console. We deliberately do
    // NOT report this anywhere else — telemetry is out of scope for T24.
    console.error('[CanvasErrorBoundary] caught render error:', error, info)
  }

  /** Soft recovery: clears the error so children re-mount. */
  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <CanvasErrorMessage
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// TanStack Router `errorComponent` adapter
// ---------------------------------------------------------------------------

interface CanvasRouteErrorComponentProps {
  /**
   * `error` is typed as `unknown` because TanStack hands us whatever was
   * thrown — could be a non-Error, a Response, etc.
   */
  error: unknown
  /** Provided by TanStack Router; re-renders the route on call. */
  reset?: () => void
}

/**
 * Use as `createFileRoute(...)({ component, errorComponent: CanvasRouteErrorComponent })`.
 * The router already provides the catch boundary — we only render the UI.
 */
export function CanvasRouteErrorComponent({
  error,
  reset,
}: CanvasRouteErrorComponentProps) {
  // Mirror the class boundary's logging so stacks are still visible in dev.
  console.error('[Canvas route] render error:', error)
  return <CanvasErrorMessage error={error} onRetry={reset} />
}
