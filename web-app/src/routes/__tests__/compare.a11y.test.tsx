/**
 * T16 a11y snapshot test for the Compare route.
 *
 * Verifies the accessibility tree shape: at least one global polite
 * `aria-live` region exists in the rendered ComparePage so screen-reader users
 * receive column status transition announcements.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'

// --- Mocks (must be hoisted above the import of the route module) ---------
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'model' in opts) return `${key}:${opts.model as string}`
      if (opts && 'path' in opts) return `${key}:${opts.path as string}`
      return key
    },
    i18n: { changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/hooks/useCompareSession', () => ({
  useCompareSession: () => ({
    columns: [],
    masterPrompt: '',
    isAnyStreaming: false,
    canSend: false,
    setMasterPrompt: vi.fn(),
    addModel: vi.fn(),
    removeModel: vi.fn(),
    sendToAll: vi.fn(),
    stopColumn: vi.fn(),
    stopAll: vi.fn(),
    clearAll: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector?: (s: { providers: unknown[] }) => unknown) => {
    const state = { providers: [] }
    return selector ? selector(state) : state
  },
  default: () => ({ providers: [] }),
}))

vi.mock('@/lib/compare-export', () => ({
  exportCompareToFile: vi.fn().mockResolvedValue({ ok: true, path: 'x' }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: { compare: '/compare' },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
}))

// --- System under test ----------------------------------------------------
import { ComparePage } from '@/routes/compare'

describe('Compare route a11y tree', () => {
  it('renders at least one aria-live region', () => {
    const { container } = render(<ComparePage />)
    const liveRegions = container.querySelectorAll('[aria-live]')
    expect(liveRegions.length).toBeGreaterThan(0)
  })

  it('exposes a global polite aria-live region for column status announcements', () => {
    const { container } = render(<ComparePage />)
    const polite = container.querySelector(
      '[data-testid="compare-aria-live"][aria-live="polite"]'
    )
    expect(polite).not.toBeNull()
    expect(polite).toHaveClass('sr-only')
  })
})
