/**
 * Unit tests for `@/lib/canvas/clipboard`.
 *
 * Strategy:
 *   - Mock `exportCanvasToPng` so we don't need the real Excalidraw runtime.
 *   - Stub `globalThis.navigator.clipboard` and `globalThis.ClipboardItem`
 *     per test (jsdom does not expose either by default in a usable shape).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the PNG exporter — clipboard pipes its output to the OS clipboard.
const mockExportPng = vi.fn()
vi.mock('@/lib/canvas/exporters', () => ({
  exportCanvasToPng: (...args: unknown[]) => mockExportPng(...args),
}))

import {
  isClipboardImageSupported,
  copyCanvasImageToClipboard,
} from './clipboard'
import type { CanvasScene } from '@/types/canvas'

// ---------------------------------------------------------------------------
// Test harness — install/uninstall a fake Clipboard surface per test.
// ---------------------------------------------------------------------------

type WriteFn = (items: unknown[]) => Promise<void>

interface MutableNavigator {
  clipboard?: { write: WriteFn }
}

function installClipboard(write: WriteFn): void {
  const nav = globalThis.navigator as unknown as MutableNavigator
  Object.defineProperty(nav, 'clipboard', {
    configurable: true,
    value: { write },
  })
  // Provide a minimal ClipboardItem constructor.
  ;(globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem =
    class FakeClipboardItem {
      constructor(public readonly data: Record<string, Blob>) {}
    } as unknown as typeof ClipboardItem
}

function uninstallClipboard(): void {
  const nav = globalThis.navigator as unknown as MutableNavigator
  // jsdom doesn't define `clipboard`; deleting via the property descriptor is safe.
  Object.defineProperty(nav, 'clipboard', { configurable: true, value: undefined })
  ;(globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem =
    undefined
}

function makeScene(): CanvasScene {
  return { elements: [], appState: {}, files: {} }
}

beforeEach(() => {
  mockExportPng.mockReset()
  uninstallClipboard()
})

afterEach(() => {
  uninstallClipboard()
})

// ---------------------------------------------------------------------------
// isClipboardImageSupported
// ---------------------------------------------------------------------------

describe('isClipboardImageSupported', () => {
  it('returns false when both clipboard.write and ClipboardItem are missing', () => {
    uninstallClipboard()
    expect(isClipboardImageSupported()).toBe(false)
  })

  it('returns false when clipboard.write exists but ClipboardItem is missing', () => {
    const nav = globalThis.navigator as unknown as MutableNavigator
    Object.defineProperty(nav, 'clipboard', {
      configurable: true,
      value: { write: async () => {} },
    })
    ;(globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem =
      undefined
    expect(isClipboardImageSupported()).toBe(false)
  })

  it('returns true when both clipboard.write and ClipboardItem are present', () => {
    installClipboard(async () => {})
    expect(isClipboardImageSupported()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// copyCanvasImageToClipboard
// ---------------------------------------------------------------------------

describe('copyCanvasImageToClipboard', () => {
  it('throws errors.clipboardUnsupported when API is missing', async () => {
    uninstallClipboard()
    await expect(copyCanvasImageToClipboard(makeScene())).rejects.toThrow(
      'errors.clipboardUnsupported'
    )
    // PNG export is not even attempted in the unsupported path.
    expect(mockExportPng).not.toHaveBeenCalled()
  })

  it('writes a PNG ClipboardItem on the happy path', async () => {
    const fakeBlob = new Blob(['png'], { type: 'image/png' })
    mockExportPng.mockResolvedValue(fakeBlob)
    const writeFn = vi.fn().mockResolvedValue(undefined)
    installClipboard(writeFn)

    await copyCanvasImageToClipboard(makeScene())

    expect(mockExportPng).toHaveBeenCalledTimes(1)
    expect(writeFn).toHaveBeenCalledTimes(1)
    const items = writeFn.mock.calls[0][0] as Array<{
      data: Record<string, Blob>
    }>
    expect(items).toHaveLength(1)
    // Our fake ClipboardItem stores the data map verbatim.
    expect(items[0].data['image/png']).toBe(fakeBlob)
  })

  it('throws errors.clipboardFailed (with cause) when navigator.clipboard.write rejects', async () => {
    const fakeBlob = new Blob(['png'], { type: 'image/png' })
    mockExportPng.mockResolvedValue(fakeBlob)
    const reason = new Error('permission denied')
    const writeFn = vi.fn().mockRejectedValue(reason)
    installClipboard(writeFn)

    let caught: Error | undefined
    try {
      await copyCanvasImageToClipboard(makeScene())
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toBe('errors.clipboardFailed')
    expect((caught as Error & { cause?: unknown }).cause).toBe(reason)
  })
})
