import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the SUT import so vi.mock() hoists correctly.
// ---------------------------------------------------------------------------

// i18n passthrough: return key, but interpolate {{date}} and {count} so the
// rendered text stays predictable and assertable.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        if ('count' in opts) return `${key}::${opts.count}`
        if ('date' in opts) return `${key}::${opts.date}`
      }
      return key
    },
  }),
}))

// Radix DropdownMenu uses a portal + Popper that needs ResizeObserver in jsdom.
// Stub with passthroughs so we can synchronously click menu items.
vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactMod = await import('react')
  const Passthrough = ({ children }: any) => <>{children}</>
  const DropdownMenuTrigger = ReactMod.forwardRef(
    ({ children, asChild, ...props }: any, ref: any) => {
      if (asChild && ReactMod.isValidElement(children)) {
        return ReactMod.cloneElement(
          children as React.ReactElement,
          { ...props, ref },
        )
      }
      return (
        <button {...props} ref={ref}>
          {children}
        </button>
      )
    },
  )
  const DropdownMenuItem = ({ children, onSelect, disabled, ...rest }: any) => (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={(e: React.MouseEvent) => {
        if (disabled) return
        onSelect?.(e)
      }}
      {...rest}
    >
      {children}
    </div>
  )
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuItem,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger,
    DropdownMenuPortal: Passthrough,
    DropdownMenuGroup: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuShortcut: Passthrough,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuCheckboxItem: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
  }
})

// CanvasIcon is an animated lottie component — stub it out.
vi.mock('@/components/animated-icon/canvas', () => ({
  CanvasIcon: () => <span data-testid="canvas-icon" />,
}))

// SUT imported AFTER the mocks
import { CanvasCard, type CanvasCardProps } from './CanvasCard'
import type { CanvasMeta } from '@/types/canvas'

const baseMeta: CanvasMeta = {
  id: 'canvas-123',
  name: 'My Wireframe',
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  elementCount: 7,
}

function renderCard(overrides: Partial<CanvasCardProps> = {}) {
  const props: CanvasCardProps = {
    meta: overrides.meta ?? baseMeta,
    onOpen: overrides.onOpen ?? vi.fn(),
    onRename: overrides.onRename ?? vi.fn(),
    onDuplicate: overrides.onDuplicate ?? vi.fn(),
    onDelete: overrides.onDelete ?? vi.fn(),
    className: overrides.className,
  }
  return { ...render(<CanvasCard {...props} />), props }
}

describe('CanvasCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the canvas name', () => {
    renderCard({ meta: { ...baseMeta, name: 'Wireframe Draft' } })
    expect(screen.getByText('Wireframe Draft')).toBeInTheDocument()
  })

  it('renders the element count badge', () => {
    renderCard({ meta: { ...baseMeta, elementCount: 42 } })
    // i18n mock interpolates count → "list.elementCount::42"
    expect(screen.getByText('list.elementCount::42')).toBeInTheDocument()
  })

  it('falls back to t("untitledCanvas") when name is empty', () => {
    renderCard({ meta: { ...baseMeta, name: '' } })
    expect(screen.getByText('untitledCanvas')).toBeInTheDocument()
  })

  it('fires onOpen(meta.id) when the card body is clicked', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderCard({ onOpen })
    await user.click(screen.getByRole('button', { name: 'list.openCanvas' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('canvas-123')
  })

  it('fires onOpen on Enter key activation', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderCard({ onOpen })
    const cardBtn = screen.getByRole('button', { name: 'list.openCanvas' })
    cardBtn.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledWith('canvas-123')
  })

  it('fires onOpen on Space key activation', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderCard({ onOpen })
    const cardBtn = screen.getByRole('button', { name: 'list.openCanvas' })
    cardBtn.focus()
    await user.keyboard(' ')
    expect(onOpen).toHaveBeenCalledWith('canvas-123')
  })

  it('fires onRename(meta.id) when the rename menu item is selected', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    renderCard({ onRename })
    const item = screen.getByRole('menuitem', { name: /toolbar\.rename/ })
    await user.click(item)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('canvas-123')
  })

  it('fires onDuplicate(meta.id) when the duplicate menu item is selected', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn()
    renderCard({ onDuplicate })
    const item = screen.getByRole('menuitem', { name: /toolbar\.duplicate/ })
    await user.click(item)
    expect(onDuplicate).toHaveBeenCalledTimes(1)
    expect(onDuplicate).toHaveBeenCalledWith('canvas-123')
  })

  it('fires onDelete(meta.id) when the delete menu item is selected', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderCard({ onDelete })
    const item = screen.getByRole('menuitem', { name: /toolbar\.delete/ })
    await user.click(item)
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('canvas-123')
  })

  it('clicking the dropdown trigger does NOT also fire onOpen (stopPropagation)', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    renderCard({ onOpen })
    const trigger = screen.getByRole('button', { name: 'toolbar.moreActions' })
    await user.click(trigger)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders a thumbnail image when meta.thumbnail is provided', () => {
    const { container } = renderCard({
      meta: { ...baseMeta, thumbnail: 'data:image/png;base64,xxx' },
    })
    // alt="" makes the img role="presentation"; query directly.
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'data:image/png;base64,xxx')
  })

  it('renders the placeholder icon when meta.thumbnail is missing', () => {
    renderCard({ meta: { ...baseMeta, thumbnail: undefined } })
    expect(screen.getByTestId('canvas-icon')).toBeInTheDocument()
  })
})
