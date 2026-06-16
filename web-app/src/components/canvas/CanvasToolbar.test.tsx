import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE the SUT import so vi.mock() hoists correctly.
// ---------------------------------------------------------------------------

// i18n passthrough — return key as-is so we can assert via aria-label / text.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Tooltip primitives are Radix Popper-based — passthrough.
vi.mock('@/components/ui/tooltip', async () => {
  const ReactMod = await import('react')
  return {
    TooltipProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ReactMod.forwardRef(
      ({ children, asChild, ...props }: any, ref: any) => {
        if (asChild && ReactMod.isValidElement(children)) {
          return ReactMod.cloneElement(
            children as React.ReactElement,
            { ...props, ref },
          )
        }
        return (
          <span {...props} ref={ref}>
            {children}
          </span>
        )
      },
    ),
    TooltipContent: () => null,
  }
})

// Radix DropdownMenu — passthrough that surfaces children synchronously and
// turns `onSelect` into the click handler. Disabled menu items are no-ops.
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

// SUT must be imported AFTER the mocks above
import {
  CanvasToolbar,
  type CanvasToolbarAction,
  type CanvasSaveStatus,
} from './CanvasToolbar'

describe('CanvasToolbar', () => {
  let onAction: ReturnType<typeof vi.fn<(a: CanvasToolbarAction) => void>>

  beforeEach(() => {
    vi.clearAllMocks()
    onAction = vi.fn()
  })

  function renderToolbar(
    overrides: Partial<{
      canvasName: string
      saveStatus: CanvasSaveStatus
      busy: boolean
    }> = {},
  ) {
    return render(
      <CanvasToolbar
        canvasName={overrides.canvasName ?? 'My Canvas'}
        saveStatus={overrides.saveStatus ?? 'saved'}
        onAction={onAction}
        busy={overrides.busy ?? false}
      />,
    )
  }

  it('renders the canvas name', () => {
    renderToolbar({ canvasName: 'Wireframe Draft' })
    expect(screen.getByText('Wireframe Draft')).toBeInTheDocument()
  })

  it('fires onAction("back") exactly once when the back button is clicked', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'toolbar.backToList' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('back')
  })

  it('fires onAction("rename") when the canvas-name button is clicked', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: 'toolbar.rename' }))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('rename')
  })

  // NOTE: Tests for the toolbar's Insert-to-chat / Copy button and the Export ▾ dropdown
  // (PNG / SVG / JSON / .excalidraw) were removed when those buttons were
  // removed from the toolbar. Excalidraw ships those actions in its own
  // built-in canvas menu, so we no longer surface them here. The
  // `'copy' | 'png' | 'svg' | 'json' | 'exportFile'` cases on the
  // `CanvasToolbarAction` type still exist for programmatic callers
  // (insert-to-chat, AI tools), but no toolbar UI fires them.

  it('fires onAction("importFile") via the more-actions menu', async () => {
    const user = userEvent.setup()
    renderToolbar()
    const item = screen.getByRole('menuitem', {
      name: /toolbar\.importExcalidraw/,
    })
    await user.click(item)
    expect(onAction).toHaveBeenCalledWith('importFile')
  })

  it('fires onAction("duplicate") via the more-actions menu', async () => {
    const user = userEvent.setup()
    renderToolbar()
    const item = screen.getByRole('menuitem', { name: /toolbar\.duplicate/ })
    await user.click(item)
    expect(onAction).toHaveBeenCalledWith('duplicate')
  })

  it('fires onAction("delete") via the more-actions menu', async () => {
    const user = userEvent.setup()
    renderToolbar()
    const item = screen.getByRole('menuitem', { name: /toolbar\.delete/ })
    await user.click(item)
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('disables every action button when busy=true', () => {
    renderToolbar({ busy: true })
    const labels = ['toolbar.backToList', 'toolbar.rename']
    for (const label of labels) {
      const btn = screen.getByRole('button', { name: label })
      expect(btn).toBeDisabled()
    }
    // The more-actions dropdown trigger is also disabled.
    const moreTriggers = screen.getAllByRole('button', {
      name: 'toolbar.moreActions',
    })
    expect(moreTriggers[0]).toBeDisabled()
  })

  it('does not fire onAction when a disabled menu item is clicked', async () => {
    const user = userEvent.setup()
    renderToolbar({ busy: true })
    const item = screen.getByRole('menuitem', { name: /toolbar\.delete/ })
    await user.click(item)
    expect(onAction).not.toHaveBeenCalled()
  })

  describe('SaveStatusPill', () => {
    it('shows the "saved" label and muted-foreground className', () => {
      renderToolbar({ saveStatus: 'saved' })
      const pill = screen.getByRole('status')
      expect(pill).toHaveTextContent('status.allChangesSaved')
      expect(pill.className).toContain('text-muted-foreground')
    })

    it('shows the "saving" label and muted-foreground className', () => {
      renderToolbar({ saveStatus: 'saving' })
      const pill = screen.getByRole('status')
      expect(pill).toHaveTextContent('toolbar.saving')
      expect(pill.className).toContain('text-muted-foreground')
    })

    it('shows the "unsaved" label with amber styling', () => {
      renderToolbar({ saveStatus: 'unsaved' })
      const pill = screen.getByRole('status')
      expect(pill).toHaveTextContent('status.unsavedChanges')
      expect(pill.className).toContain('text-amber-500')
    })

    it('shows the error label with destructive styling', () => {
      renderToolbar({ saveStatus: 'error' })
      const pill = screen.getByRole('status')
      expect(pill).toHaveTextContent('errors.saveFailed')
      expect(pill.className).toContain('text-destructive')
    })
  })
})
