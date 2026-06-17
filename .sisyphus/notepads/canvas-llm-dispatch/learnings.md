# Learnings — canvas-llm-dispatch

<!-- Append only. Never overwrite. Format: ## [TIMESTAMP] Task: {task-id} -->

## [2026-06-17] Task: T3
CanvasAiIndicator progress prop: optional, renders "(N/M)" inline after label. data-testid="canvas-ai-indicator-counter" on counter span.

## [2026-06-17] Task: T4
CanvasModelPicker: uses useModelProvider (Zustand store, @/hooks/useModelProvider) for models list via selector (state) => state.providers, shadcn DropdownMenu. Props: selectedModel: ModelInfo | null, onModelChange: (model: ModelInfo) => void, disabled?: boolean. ModelInfo is a local type { id, name, provider } derived from Model + ModelProvider. Embedding models filtered out. 14/14 tests pass, LSP clean, tsc -b --noEmit zero errors.
