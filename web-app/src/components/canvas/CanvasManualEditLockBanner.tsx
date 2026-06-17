/**
 * CanvasManualEditLockBanner — non-blocking "manual edits paused" banner
 * =======================================================================
 *
 * Wave 5 / T22 (excalidraw-mcp-canvas-integration). Pure presentational
 * surface that visualises the orchestrator's manual-edit lock state while
 * an MCP-driven drawing session has acquired one or more reference-counted
 * locks.
 *
 * Visibility contract (plan §2186):
 *   - isLocked === false → hidden (returns null)
 *   - isLocked === true  → visible banner with the literal text
 *                          "AI is drawing — manual edits paused"
 *
 * Why a SEPARATE component from `CanvasAiIndicator` (T19)?
 *   - The indicator (top-right pill, spinner) reflects the orchestrator's
 *     lifecycle STATE (`spawning` / `awaiting-approval` / `drawing`). The
 *     banner reflects the manual-edit LOCK state (refCount > 0). The two
 *     can be ON simultaneously (drawing + locked) or independently (e.g.
 *     a programmatic batch with no UI lock; an awaiting-approval lock
 *     hold-over).
 *   - Plan §2186 asks for a "small banner near top of canvas" that reads
 *     "manual edits paused", with the SAME styling vocabulary as T19 but
 *     a DIFFERENT position. Top-CENTER (this component) vs top-RIGHT
 *     (T19 indicator) avoids stacking — both can render simultaneously.
 *
 * Why `pointer-events-none` is non-negotiable:
 *   - The banner overlays the Excalidraw canvas. If it captured pointer
 *     events even a small horizontal strip would silently break selection
 *     / drawing in that band. Same constraint as T19.
 *
 * Why `aria-live="polite"`:
 *   - Lock acquisitions are not urgent — the user already saw the AI
 *     start a batch (T19 indicator covers that announcement). The banner
 *     supplements with the lock-specific message; `polite` is correct.
 *
 * Why subscribing to the orchestrator lives ELSEWHERE:
 *   - This component receives `isLocked` as a prop. T20 wires the
 *     subscription via `orchestrator.subscribeManualEditLock(...)` so the
 *     component stays trivially renderable in isolation (vital for the
 *     storybook / visual-test path).
 *
 * Render-budget: identical to T19 — single ternary over `isLocked`, no
 * effects, no stores, no dynamic imports. Commits well under one frame.
 */
import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'

export type CanvasManualEditLockBannerProps = {
  /** Drives visibility. T20 sources this from `isManualEditLocked()`. */
  isLocked: boolean
  /** Optional caller-supplied classes (positioning override, theming hooks). */
  className?: string
}

const BANNER_TEXT = 'AI is drawing — manual edits paused'

/**
 * Visible if and only if the manual-edit lock is held (refCount > 0 in
 * the underlying `LockController`).
 */
export function CanvasManualEditLockBanner({
  isLocked,
  className,
}: CanvasManualEditLockBannerProps): JSX.Element | null {
  if (!isLocked) {
    return null
  }

  return (
    <div
      data-testid="canvas-manual-edit-lock-banner"
      role="status"
      aria-live="polite"
      className={cn(
        // Positioning: top-CENTER of the nearest positioned ancestor (the
        // canvas container in T20). `absolute` keeps the banner scoped
        // to the canvas viewport. Distinct from T19's top-RIGHT pill so
        // the two never collide when rendered simultaneously
        // (drawing + locked is the common case).
        'absolute left-1/2 top-3 z-30 -translate-x-1/2',
        // Visual: pill shape mirroring CanvasAiIndicator's vocabulary so
        // the two banners feel like part of the same chrome family.
        'flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5',
        'text-xs font-medium text-muted-foreground shadow-sm backdrop-blur',
        // Critical: must NEVER intercept pointer events on the canvas.
        // Plan §2194 forbids disabling Excalidraw entirely; the banner +
        // `viewModeEnabled` together are the contract — no input capture.
        'pointer-events-none select-none',
        // Whitespace: keep the en-dash phrase on a single line for the
        // small viewports — `whitespace-nowrap` is fine here because the
        // string is short and fixed.
        'whitespace-nowrap',
        className,
      )}
    >
      <Lock className="size-3.5" aria-hidden="true" />
      <span>{BANNER_TEXT}</span>
    </div>
  )
}

export default CanvasManualEditLockBanner
