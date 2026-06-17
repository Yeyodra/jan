/**
 * CanvasAiIndicator — non-blocking "AI is drawing…" overlay
 * =========================================================
 *
 * Wave 5 / T19 (excalidraw-mcp-canvas-integration). Pure presentational
 * surface that visualises the orchestrator's lifecycle while an MCP-driven
 * drawing session is in flight.
 *
 * Visibility contract (locked at exactly 5 OrchestratorState values — see
 * `web-app/src/lib/canvas-mcp-orchestrator/types.ts`):
 *   - 'idle'              → hidden (returns null)
 *   - 'spawning'          → visible
 *   - 'awaiting-approval' → visible
 *   - 'drawing'           → visible
 *   - 'error'             → hidden (CanvasErrorBoundary owns the error UX;
 *                           this indicator silently dismisses)
 *
 * Why a fixed-string label and no progress / cancel UI?
 *   - V1 scope lock from plan §1932-1937. Cancel button, progress %, and
 *     element-count read-outs are explicitly out of scope. Adding them here
 *     would couple this component to orchestrator internals it must not own.
 *
 * Why `pointer-events-none` is non-negotiable:
 *   - The overlay sits on top of the Excalidraw canvas. If it captured
 *     pointer events, even a small top-right rectangle would silently break
 *     selection / drawing in that corner. Plan §1937 forbids it.
 *
 * Why `aria-live="polite"`:
 *   - The spawn → drawing transition can take up to ~800ms (T4 spike). For
 *     screen-reader users we announce the in-flight state without barging
 *     into other live regions. `polite` is correct here — the state change
 *     is informational, not urgent.
 *
 * Render-budget intent (16ms / single React frame, plan §1972):
 *   - The component does zero side-effects, owns no state, and reads no
 *     stores. Render is a single ternary over the `state` prop; React's
 *     reconciler can commit it in well under one frame. The test file
 *     enforces a 50ms wall-clock ceiling to catch regressions (e.g.,
 *     accidental dynamic imports or expensive className computation).
 *
 * What this component intentionally does NOT do:
 *   - Subscribe to the orchestrator. It receives `state` from a parent
 *     (T20 wires this in `/canvas/$canvasId.tsx`). Keeping it dumb makes it
 *     trivially composable inside CanvasPromptBar (T18) too if we change
 *     our minds later.
 *   - Animate appearance/disappearance. The spinner itself rotates; framing
 *     the whole overlay in a fade animation would add Motion/Framer cost
 *     for a 200ms-budget UI. We can revisit if UX feedback demands it.
 */
import { Loader } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { OrchestratorState } from '@/lib/canvas-mcp-orchestrator/types'

export type CanvasAiIndicatorProps = {
  /** Current orchestrator lifecycle state. Drives visibility. */
  state: OrchestratorState
  /** Optional caller-supplied classes (positioning override, theming hooks). */
  className?: string
  /**
   * Optional draw progress. When provided (and total > 0), renders
   * "AI is drawing… (current/total)" inline after the label.
   */
  progress?: { current: number; total: number }
}

/**
 * Visible if and only if the orchestrator is mid-flight.
 *
 * The narrow union below mirrors the OrchestratorState contract — adding a
 * new state in `types.ts` will surface here as a TS error and force an
 * explicit visibility decision.
 */
const VISIBLE_STATES: ReadonlySet<OrchestratorState> = new Set<OrchestratorState>([
  'spawning',
  'awaiting-approval',
  'drawing',
])

export function CanvasAiIndicator({
  state,
  className,
  progress,
}: CanvasAiIndicatorProps): JSX.Element | null {
  if (!VISIBLE_STATES.has(state)) {
    return null
  }

  return (
    <div
      data-testid="canvas-ai-indicator"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        // Positioning: top-right of the nearest positioned ancestor (the
        // canvas container in T20). `absolute` (not `fixed`) keeps the
        // overlay scoped to the canvas viewport so multiple canvases or
        // split-pane future work won't break it.
        'absolute right-3 top-3 z-30',
        // Visual: small pill matching Jan's existing chrome tokens. Border
        // + bg-background mirrors CanvasToolbar's vocabulary so the two
        // never clash visually.
        'flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5',
        'text-xs font-medium text-muted-foreground shadow-sm backdrop-blur',
        // Critical: must NEVER intercept pointer events on the canvas.
        // Plan §1937 explicitly forbids blocking canvas interaction.
        'pointer-events-none select-none',
        className,
      )}
    >
      <Loader className="size-3.5 animate-spin" aria-hidden="true" />
      <span>AI is drawing…</span>
      {progress && progress.total > 0 && (
        <span data-testid="canvas-ai-indicator-counter">
          ({progress.current}/{progress.total})
        </span>
      )}
    </div>
  )
}

export default CanvasAiIndicator
