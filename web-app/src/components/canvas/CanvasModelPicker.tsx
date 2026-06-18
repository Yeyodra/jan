/**
 * CanvasModelPicker — compact model selector for the canvas prompt bar.
 *
 * Sits inside the prompt bar (T11 wires it in). Shows the currently selected
 * model name + a chevron; clicking opens a DropdownMenu listing every model
 * available across all active providers.
 *
 * Design anchors (matches CanvasToolbar / CanvasPromptBar):
 *   - `DropdownMenu` from `@/components/ui/dropdown-menu` — same primitive
 *     CanvasToolbar uses for the ⋯ menu.
 *   - Tailwind tokens: `bg-background`, `border-input`, `text-muted-foreground`,
 *     `text-xs`, `gap-1`, `px-2`, `py-1` — same scale.
 *   - Max trigger width ~120px with `truncate` on the label.
 *
 * This component is PURE PRESENTATIONAL + hook. No orchestrator coupling.
 * `useModelProvider` (Zustand store) is called inside to get the providers list;
 * the parent passes `selectedModel` / `onModelChange` to stay decoupled.
 */
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModelProvider } from '@/hooks/useModelProvider'

// ---------------------------------------------------------------------------
// Public type — a flat view of a model + its provider name, used as the
// unit of selection. The task spec calls this `ModelInfo`; it wraps the
// existing global `Model` type with the provider string alongside it so
// callers never have to reach back into `ModelProvider[]` to learn which
// provider a model belongs to.
// ---------------------------------------------------------------------------
export type ModelInfo = {
  /** Unique model ID (matches `Model.id`) */
  id: string
  /** Human-readable display name. Falls back to `id` when absent. */
  name: string
  /** Provider identifier (e.g. "llamacpp", "openai") */
  provider: string
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type CanvasModelPickerProps = {
  /** Currently active model, or `null` when nothing is selected yet. */
  selectedModel: ModelInfo | null
  /** Fired when the user picks a different model from the dropdown. */
  onModelChange: (model: ModelInfo) => void
  /** Grays out the trigger and blocks interaction. */
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function CanvasModelPicker({
  selectedModel,
  onModelChange,
  disabled = false,
}: CanvasModelPickerProps) {
  // Pull all providers from the Zustand store. Each provider has a `models`
  // array; we flatten into a single ModelInfo[] for the dropdown list.
  const providers = useModelProvider((state) => state.providers)

  const allModels: ModelInfo[] = providers.flatMap((provider) =>
    (provider.models ?? [])
      .filter((m) => !m.embedding) // embedding models are not for LLM dispatch
      .map((m) => ({
        id: m.id,
        name: m.displayName ?? m.name ?? m.id,
        provider: provider.provider,
      }))
  )

  const hasModels = allModels.length > 0
  const isDisabled = disabled || !hasModels

  const triggerLabel = !hasModels
    ? 'No model'
    : (selectedModel?.name ?? 'Select model')

  return (
    <div data-testid="canvas-model-picker" className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={isDisabled}>
          <button
            data-testid="canvas-model-picker-trigger"
            disabled={isDisabled}
            aria-label={`Model: ${triggerLabel}`}
            className={cn(
              // Layout
              'inline-flex max-w-[120px] items-center gap-1 rounded-md',
              // Spacing / type — matches CanvasToolbar button scale
              'px-2 py-1 text-xs',
              // Colours — semantic tokens, theme-aware
              'bg-background border border-input text-foreground',
              'hover:bg-accent hover:text-accent-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              // Disabled state
              isDisabled && 'cursor-not-allowed opacity-50',
              // Transition
              'transition-colors duration-150'
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="top"
          className="min-w-[180px] max-w-[240px]"
        >
          {allModels.map((model, index) => {
            const isSelected = model.id === selectedModel?.id
            // Insert a separator before the first model of each new provider
            const prevModel = allModels[index - 1]
            const showSeparator =
              index > 0 && prevModel && prevModel.provider !== model.provider

            return (
              <span key={`${model.provider}:${model.id}`}>
                {showSeparator && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  data-testid={`canvas-model-picker-option-${index}`}
                  onSelect={() => onModelChange(model)}
                  className={cn(
                    'flex items-center justify-between gap-2 text-xs',
                    isSelected && 'font-medium'
                  )}
                >
                  {/* Model name */}
                  <span className="truncate">{model.name}</span>
                  {/* Provider badge */}
                  <span className="shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {model.provider}
                  </span>
                </DropdownMenuItem>
              </span>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
