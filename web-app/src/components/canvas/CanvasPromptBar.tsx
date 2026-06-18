/**
 * CanvasPromptBar — bottom-docked prompt input for the canvas detail route.
 *
 * Pure presentational component. The parent route (T20) owns orchestrator
 * wiring (`beginAiBatch` / `endAiBatch`), LLM dispatch, and the
 * `isSubmitting` flag derived from `OrchestratorState !== 'idle'`. This file
 * stays decoupled from `web-app/src/lib/canvas-mcp-orchestrator/` so the
 * component can be unit-tested without spinning up the orchestrator.
 *
 * V1 scope lock (per plan T18):
 *   - Single-line text input + send button.
 *   - Submit gating: empty/whitespace, no canvas, or in-flight batch → disabled.
 *   - Optimistic clear on submit; restore the value if `onSubmit` rejects.
 *   - NO history, autocomplete, voice, slash-commands, attachments, or model
 *     picker. Those are explicitly out of scope.
 *
 * Design system anchors:
 *   - `Button` from `@/components/ui/button` (icon-sm, variant=default,
 *     rounded-full — matches ChatInput's send button at line 2184–2193).
 *   - `Input` from `@/components/ui/input` (focus ring, border, transition
 *     tokens already in the design system).
 *   - Tailwind tokens: `bg-background`, `border-input`, `text-muted-foreground`,
 *     `gap-2`, `p-2` — same scale as CanvasToolbar.
 */
import { useCallback, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, Loader2, Square } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type CanvasPromptBarProps = {
  /** Active canvas id. `null` → bar is disabled (no target to draw on). */
  canvasId: string | null
  /** True while the orchestrator's batch is in flight. Parent-controlled. */
  isSubmitting: boolean
  /** Fired with the trimmed prompt. Parent owns orchestrator + LLM wiring. */
  onSubmit: (prompt: string) => void | Promise<void>
  /**
   * When provided and `isSubmitting` is true, renders a Stop button (Square
   * icon) in place of the Send button. Calling it aborts the in-flight batch.
   * When absent and `isSubmitting` is true, falls back to the Loader2 spinner.
   */
  onStop?: () => void
  /**
   * Optional model picker rendered to the LEFT of the send/stop button.
   * Injected by the parent via ReactNode slot so CanvasPromptBar stays
   * generic and does not import CanvasModelPicker directly.
   */
  modelPicker?: ReactNode
  /** Optional placeholder. Defaults to "Ask AI to draw…". */
  placeholder?: string
  /** Optional outer container className for layout overrides. */
  className?: string
}

/**
 * Bottom-docked prompt bar for the canvas page.
 *
 * Behavior:
 *   - Empty/whitespace input → Send disabled, Enter is a no-op.
 *   - On submit (Enter without Shift, or Send click):
 *       1. Clear the input optimistically.
 *       2. Call `onSubmit(trimmedPrompt)`.
 *       3. If `onSubmit` throws/rejects, restore the input so the user can
 *          retry without re-typing.
 *   - Disabled (input + button) when `canvasId === null` OR `isSubmitting`.
 *   - Loading affordance: inline `Loader2` swap on the Send button while
 *     `isSubmitting`, plus a visually-hidden `aria-live` region announcing
 *     "AI is drawing" for screen readers.
 */
export function CanvasPromptBar({
  canvasId,
  isSubmitting,
  onSubmit,
  onStop,
  modelPicker,
  placeholder = 'Ask AI to draw…',
  className,
}: CanvasPromptBarProps) {
  const [value, setValue] = useState('')

  const trimmed = value.trim()
  const noActiveCanvas = canvasId === null
  const inputDisabled = noActiveCanvas || isSubmitting
  const sendDisabled = inputDisabled || trimmed.length === 0

  const submit = useCallback(async () => {
    if (sendDisabled) return
    const prompt = trimmed
    // Optimistic clear — feels instant, matches Jan's chat input UX.
    setValue('')
    try {
      await onSubmit(prompt)
    } catch {
      // Restore the value so the user can retry without re-typing.
      // Parent is expected to surface error UX (toast / inline) itself.
      setValue(prompt)
    }
  }, [onSubmit, sendDisabled, trimmed])

  const handleFormSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void submit()
    },
    [submit],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // Enter handling for V1 (single-line):
      //   - Enter (no Shift) → submit.
      //   - Shift+Enter → suppressed (no newline, no submit). Reserved for
      //     a future multi-line variant.
      // We always preventDefault on Enter so the native form-submit pathway
      // never bypasses our gating logic.
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (e.shiftKey) return
      void submit()
    },
    [submit],
  )

  return (
    <form
      data-testid="canvas-prompt-bar"
      onSubmit={handleFormSubmit}
      className={cn(
        'flex items-center gap-2 w-full p-2 bg-background border-t border-input',
        className,
      )}
      aria-label="Canvas AI prompt"
    >
      {/* Visually-hidden label for the input — keeps the layout clean while
          giving screen readers an explicit name. */}
      <label htmlFor="canvas-prompt-input" className="sr-only">
        Prompt for the canvas AI
      </label>
      <Input
        id="canvas-prompt-input"
        data-testid="canvas-prompt-input"
        type="text"
        autoComplete="off"
        spellCheck
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={inputDisabled}
        placeholder={
          noActiveCanvas ? 'Open a canvas to start prompting…' : placeholder
        }
        aria-label="Prompt for the canvas AI"
        aria-busy={isSubmitting || undefined}
        className="flex-1"
      />

      {/* Model picker slot — injected by the parent route, rendered LEFT of
          the send/stop button. Nothing renders when the prop is omitted. */}
      {modelPicker}

      {isSubmitting && onStop ? (
        /* Stop button — shown when a batch is in flight and parent can cancel */
        <Button
          type="button"
          variant="default"
          size="icon-sm"
          onClick={onStop}
          data-testid="canvas-prompt-stop"
          aria-label="Stop AI"
        >
          <Square className="text-primary-fg" />
        </Button>
      ) : (
        /* Send / loading button */
        <Button
          type="submit"
          variant="default"
          size="icon-sm"
          disabled={sendDisabled}
          data-testid="canvas-prompt-send"
          aria-label={isSubmitting ? 'AI is drawing' : 'Send to AI'}
        >
          {isSubmitting ? (
            <Loader2 className="text-primary-fg animate-spin" />
          ) : (
            <ArrowRight className="text-primary-fg" />
          )}
        </Button>
      )}

      {/* Live region — announces submit state to assistive tech without
          shifting layout. Empty when idle. */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="canvas-prompt-status"
      >
        {isSubmitting ? 'AI is drawing' : ''}
      </span>
    </form>
  )
}

export default CanvasPromptBar
