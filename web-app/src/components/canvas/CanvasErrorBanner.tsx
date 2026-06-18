/**
 * CanvasErrorBanner — non-blocking "AI paused" error banner
 * ==========================================================
 *
 * T9 (canvas-llm-dispatch). Pure presentational surface that surfaces a
 * dispatch-loop error to the user with optional retry capability.
 *
 * Visibility contract:
 *   - Rendered by the parent only when errorState !== null.
 *   - canRetry === false → Retry button hidden; only Dismiss is shown.
 *
 * Positioning: mirrors CanvasManualEditLockBanner — top-CENTER absolute,
 * z-30, same pill shape vocabulary. Offset slightly lower (top-12) so both
 * banners can render simultaneously without overlapping.
 *
 * Non-modal contract:
 *   - The banner container is `pointer-events-none` so the canvas remains
 *     fully interactive beneath it.
 *   - Each interactive button carries `pointer-events-auto` to re-enable
 *     click capture only on the button itself.
 */
import { AlertCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export type CanvasErrorBannerProps = {
  /** Error details driving visibility and copy. */
  error: {
    /** Human-readable message: shown as "AI paused: {message}". */
    message: string
    /** When false, the Retry button is hidden. */
    canRetry: boolean
  }
  /** Called when the user clicks [Retry]. */
  onRetry: () => void
  /** Called when the user clicks [Dismiss]. */
  onDismiss: () => void
  /** Optional caller-supplied classes (positioning override, theming hooks). */
  className?: string
}

/**
 * Non-blocking error banner rendered near the top of the canvas when the
 * AI dispatch loop encounters an error.
 */
export function CanvasErrorBanner({
  error,
  onRetry,
  onDismiss,
  className,
}: CanvasErrorBannerProps) {
  return (
    <div
      data-testid="canvas-error-banner"
      role="alert"
      aria-live="assertive"
      className={cn(
        // Positioning: top-CENTER, offset lower than the lock banner (top-12
        // vs top-3) so both can coexist without pixel-level overlap.
        'absolute left-1/2 top-12 z-30 -translate-x-1/2',
        // Visual: pill shape matching CanvasManualEditLockBanner vocabulary.
        'flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5',
        'text-xs font-medium shadow-sm backdrop-blur',
        // Error colouring: destructive-tinted text to signal problem state.
        'text-destructive',
        // Critical: the wrapper itself must NEVER intercept pointer events —
        // only the buttons below re-enable pointer capture.
        'pointer-events-none select-none',
        'whitespace-nowrap',
        className,
      )}
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>AI paused: {error.message}</span>

      {error.canRetry && (
        <button
          type="button"
          data-testid="canvas-error-retry"
          onClick={onRetry}
          className={cn(
            'pointer-events-auto',
            'ml-1 rounded px-1.5 py-0.5',
            'text-xs font-semibold',
            'border border-destructive/40 text-destructive',
            'hover:bg-destructive/10 transition-colors',
          )}
        >
          Retry
        </button>
      )}

      <button
        type="button"
        data-testid="canvas-error-dismiss"
        onClick={onDismiss}
        className={cn(
          'pointer-events-auto',
          'ml-0.5 rounded px-1.5 py-0.5',
          'text-xs font-semibold',
          'border border-border text-muted-foreground',
          'hover:bg-muted/50 transition-colors',
        )}
      >
        Dismiss
      </button>
    </div>
  )
}

export default CanvasErrorBanner
