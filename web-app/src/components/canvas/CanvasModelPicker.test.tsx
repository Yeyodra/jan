/**
 * CanvasModelPicker — unit tests (T4, canvas-llm-dispatch)
 *
 * Behavior contract:
 *   - Renders trigger showing selected model name
 *   - Click trigger → dropdown opens, shows model list with testids
 *   - Click option → onModelChange called with correct ModelInfo
 *   - disabled=true → trigger is disabled, click does nothing
 *   - No models available → trigger shows "No model" and is disabled
 *
 * Hook mock: vi.mock('@/hooks/useModelProvider') stubs the Zustand store
 * selector so tests run without a DOM localStorage or Zustand environment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CanvasModelPicker } from './CanvasModelPicker'
import type { ModelInfo } from './CanvasModelPicker'

// ---------------------------------------------------------------------------
// Mock useModelProvider (Zustand store)
// ---------------------------------------------------------------------------
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

import { useModelProvider } from '@/hooks/useModelProvider'

// Typed helper — useModelProvider is a Zustand store, but in tests we stub
// the selector call with whatever the selector returns when given mock state.
const mockUseModelProvider = useModelProvider as unknown as ReturnType<typeof vi.fn>

// Helper: configure the mock to return a flat providers list whose models are
// exposed through the selector `(state) => state.providers`.
function setMockProviders(providers: Array<{ provider: string; models: Array<{ id: string; name?: string; displayName?: string; embedding?: boolean }> }>) {
  // useModelProvider is called as: useModelProvider(selectorFn)
  // Simulate Zustand by calling the selector with a fake state object.
  mockUseModelProvider.mockImplementation((selector: (s: { providers: typeof providers }) => unknown) =>
    selector({ providers })
  )
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MODEL_A: ModelInfo = { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' }
const MODEL_B: ModelInfo = { id: 'llama3', name: 'Llama 3', provider: 'llamacpp' }

const PROVIDERS_TWO = [
  {
    provider: 'openai',
    models: [{ id: 'gpt-4o', displayName: 'GPT-4o' }],
  },
  {
    provider: 'llamacpp',
    models: [{ id: 'llama3', name: 'Llama 3' }],
  },
]

const PROVIDERS_EMPTY: typeof PROVIDERS_TWO = []

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPicker(
  overrides: Partial<React.ComponentProps<typeof CanvasModelPicker>> = {},
) {
  const defaults = {
    selectedModel: MODEL_A,
    onModelChange: vi.fn(),
  }
  const props = { ...defaults, ...overrides }
  const utils = render(<CanvasModelPicker {...props} />)
  return { ...utils, props }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CanvasModelPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMockProviders(PROVIDERS_TWO)
  })

  // ── Renders ──────────────────────────────────────────────────────────────

  it('renders root and trigger with correct testids', () => {
    renderPicker()
    expect(screen.getByTestId('canvas-model-picker')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-model-picker-trigger')).toBeInTheDocument()
  })

  it('trigger shows the selected model name', () => {
    renderPicker({ selectedModel: MODEL_A })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toHaveTextContent('GPT-4o')
  })

  // ── Dropdown open / model list ────────────────────────────────────────────

  it('click trigger → dropdown opens and shows model options', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))

    // Two models → two options
    expect(screen.getByTestId('canvas-model-picker-option-0')).toBeInTheDocument()
    expect(screen.getByTestId('canvas-model-picker-option-1')).toBeInTheDocument()
  })

  it('each option shows model name and provider badge', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))

    const opt0 = screen.getByTestId('canvas-model-picker-option-0')
    const opt1 = screen.getByTestId('canvas-model-picker-option-1')

    expect(opt0).toHaveTextContent('GPT-4o')
    expect(opt0).toHaveTextContent('openai')
    expect(opt1).toHaveTextContent('Llama 3')
    expect(opt1).toHaveTextContent('llamacpp')
  })

  // ── onModelChange ─────────────────────────────────────────────────────────

  it('clicking an option calls onModelChange with the correct ModelInfo', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderPicker({ onModelChange })

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))
    await user.click(screen.getByTestId('canvas-model-picker-option-1'))

    expect(onModelChange).toHaveBeenCalledOnce()
    expect(onModelChange).toHaveBeenCalledWith<[ModelInfo]>({
      id: 'llama3',
      name: 'Llama 3',
      provider: 'llamacpp',
    })
  })

  it('clicking the already-selected option still calls onModelChange', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderPicker({ selectedModel: MODEL_A, onModelChange })

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))
    await user.click(screen.getByTestId('canvas-model-picker-option-0'))

    expect(onModelChange).toHaveBeenCalledOnce()
    expect(onModelChange).toHaveBeenCalledWith<[ModelInfo]>({
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
    })
  })

  // ── disabled prop ─────────────────────────────────────────────────────────

  it('disabled=true → trigger button is disabled', () => {
    renderPicker({ disabled: true })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toBeDisabled()
  })

  it('disabled=true → click does not fire onModelChange', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderPicker({ disabled: true, onModelChange })

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))

    expect(onModelChange).not.toHaveBeenCalled()
  })

  // ── no models ─────────────────────────────────────────────────────────────

  it('no models → trigger shows "No model"', () => {
    setMockProviders(PROVIDERS_EMPTY)
    renderPicker({ selectedModel: null })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toHaveTextContent('No model')
  })

  it('no models → trigger is disabled', () => {
    setMockProviders(PROVIDERS_EMPTY)
    renderPicker({ selectedModel: null })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toBeDisabled()
  })

  it('no models → click does not fire onModelChange', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    setMockProviders(PROVIDERS_EMPTY)
    renderPicker({ selectedModel: null, onModelChange })

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))

    expect(onModelChange).not.toHaveBeenCalled()
  })

  // ── null selectedModel with models available ───────────────────────────────

  it('selectedModel=null with models → trigger shows "Select model"', () => {
    renderPicker({ selectedModel: null })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toHaveTextContent('Select model')
  })

  // ── embedding models filtered out ─────────────────────────────────────────

  it('embedding models are not shown in the dropdown', async () => {
    const user = userEvent.setup()
    setMockProviders([
      {
        provider: 'openai',
        models: [
          { id: 'gpt-4o', displayName: 'GPT-4o' },
          { id: 'text-embedding-3-small', displayName: 'Embedding Small', embedding: true },
        ],
      },
    ])
    renderPicker()

    await user.click(screen.getByTestId('canvas-model-picker-trigger'))

    // Only 1 option (the LLM); embedding model must not appear
    expect(screen.getByTestId('canvas-model-picker-option-0')).toBeInTheDocument()
    expect(screen.queryByTestId('canvas-model-picker-option-1')).not.toBeInTheDocument()
    expect(screen.queryByText('Embedding Small')).not.toBeInTheDocument()
  })

  // ── MODEL_B selection ─────────────────────────────────────────────────────

  it('renders with MODEL_B selected', () => {
    renderPicker({ selectedModel: MODEL_B })
    expect(screen.getByTestId('canvas-model-picker-trigger')).toHaveTextContent('Llama 3')
  })
})
