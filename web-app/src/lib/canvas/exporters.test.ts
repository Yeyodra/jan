/**
 * Unit tests for `@/lib/canvas/exporters`.
 *
 * We mock `@excalidraw/excalidraw` so the test does not load the real
 * package (which pulls in the full canvas runtime, fonts, and DOM
 * dependencies that jsdom can't fully satisfy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @excalidraw/excalidraw — the only external surface used by exporters.
// ---------------------------------------------------------------------------

const mockExportToBlob = vi.fn()
const mockExportToSvg = vi.fn()
const mockSerializeAsJSON = vi.fn()

vi.mock('@excalidraw/excalidraw', () => ({
  exportToBlob: (args: unknown) => mockExportToBlob(args),
  exportToSvg: (args: unknown) => mockExportToSvg(args),
  serializeAsJSON: (
    elements: unknown,
    appState: unknown,
    files: unknown,
    type: unknown
  ) => mockSerializeAsJSON(elements, appState, files, type),
}))

import {
  exportCanvasToPng,
  exportCanvasToSvg,
  exportCanvasToJson,
  downloadBlob,
} from './exporters'
import type { Canvas, CanvasScene } from '@/types/canvas'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeScene(): CanvasScene {
  return {
    elements: [],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }
}

function makeCanvas(): Canvas {
  return {
    id: 'cv-1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    elements: [],
    appState: { viewBackgroundColor: '#fff' },
    files: {},
  }
}

beforeEach(() => {
  mockExportToBlob.mockReset()
  mockExportToSvg.mockReset()
  mockSerializeAsJSON.mockReset()
})

// ---------------------------------------------------------------------------
// exportCanvasToPng
// ---------------------------------------------------------------------------

describe('exportCanvasToPng', () => {
  it('returns the Blob produced by exportToBlob with default scale=2', async () => {
    const fakeBlob = new Blob(['png-bytes'], { type: 'image/png' })
    mockExportToBlob.mockResolvedValue(fakeBlob)

    const result = await exportCanvasToPng(makeScene())

    expect(result).toBe(fakeBlob)
    expect(mockExportToBlob).toHaveBeenCalledTimes(1)

    const args = mockExportToBlob.mock.calls[0][0] as {
      mimeType: string
      appState: { exportBackground: boolean; exportScale: number }
      exportPadding: number
      getDimensions?: unknown
    }
    expect(args.mimeType).toBe('image/png')
    expect(args.appState.exportBackground).toBe(true)
    // We rely on Excalidraw's native `exportScale` field rather than a
    // custom `getDimensions` callback (which has a more delicate
    // contract with the renderer and produced miniaturized output).
    expect(args.appState.exportScale).toBe(2)
    expect(args.getDimensions).toBeUndefined()
    // `exportPadding` is a top-level option on `exportToBlob`; default
    // matches Excalidraw's own (`10`).
    expect(args.exportPadding).toBe(10)
  })

  it('honors withBackground=false and custom scale', async () => {
    mockExportToBlob.mockResolvedValue(new Blob([]))

    await exportCanvasToPng(makeScene(), { withBackground: false, scale: 3 })

    const args = mockExportToBlob.mock.calls[0][0] as {
      appState: { exportBackground: boolean; exportScale: number }
      exportPadding: number
    }
    expect(args.appState.exportBackground).toBe(false)
    expect(args.appState.exportScale).toBe(3)
    expect(args.exportPadding).toBe(10)
  })

  it('forwards a caller-supplied exportPadding from appState to the top-level option', async () => {
    mockExportToBlob.mockResolvedValue(new Blob([]))

    const scene: CanvasScene = {
      elements: [],
      appState: {
        viewBackgroundColor: '#ffffff',
        // Cast through `unknown` because `exportPadding` lives on the
        // exported-options surface, not the `AppState` type proper.
        exportPadding: 42,
      } as unknown as CanvasScene['appState'],
      files: {},
    }
    await exportCanvasToPng(scene)

    const args = mockExportToBlob.mock.calls[0][0] as {
      exportPadding: number
    }
    expect(args.exportPadding).toBe(42)
  })

  it('propagates errors thrown by exportToBlob', async () => {
    mockExportToBlob.mockRejectedValue(new Error('canvas oom'))
    await expect(exportCanvasToPng(makeScene())).rejects.toThrow('canvas oom')
  })
})

// ---------------------------------------------------------------------------
// exportCanvasToSvg
// ---------------------------------------------------------------------------

describe('exportCanvasToSvg', () => {
  it('serializes the SVG element returned by exportToSvg with XMLSerializer', async () => {
    // Create a real DOM SVG element so XMLSerializer can serialize it.
    const svg = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ) as SVGSVGElement
    svg.setAttribute('width', '10')
    svg.setAttribute('height', '20')
    mockExportToSvg.mockResolvedValue(svg)

    const result = await exportCanvasToSvg(makeScene())

    expect(typeof result).toBe('string')
    expect(result).toContain('<svg')
    expect(result).toContain('width="10"')
    expect(result).toContain('height="20"')
    expect(mockExportToSvg).toHaveBeenCalledTimes(1)

    const args = mockExportToSvg.mock.calls[0][0] as {
      appState: { exportBackground: boolean; viewBackgroundColor: string }
    }
    expect(args.appState.exportBackground).toBe(true)
    expect(args.appState.viewBackgroundColor).toBe('#ffffff')
  })

  it('passes withBackground=false through to appState.exportBackground', async () => {
    const svg = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ) as SVGSVGElement
    mockExportToSvg.mockResolvedValue(svg)

    await exportCanvasToSvg(makeScene(), { withBackground: false })

    const args = mockExportToSvg.mock.calls[0][0] as {
      appState: { exportBackground: boolean }
    }
    expect(args.appState.exportBackground).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// exportCanvasToJson
// ---------------------------------------------------------------------------

describe('exportCanvasToJson', () => {
  it('delegates to serializeAsJSON with type="local" and returns its string', () => {
    const expected =
      '{"type":"excalidraw","version":2,"source":"jan-test","elements":[],"appState":{},"files":{}}'
    mockSerializeAsJSON.mockReturnValue(expected)

    const canvas = makeCanvas()
    const result = exportCanvasToJson(canvas)

    expect(result).toBe(expected)
    expect(mockSerializeAsJSON).toHaveBeenCalledTimes(1)
    expect(mockSerializeAsJSON).toHaveBeenCalledWith(
      canvas.elements,
      canvas.appState,
      canvas.files,
      'local'
    )
  })

  it('produces parseable JSON conforming to the .excalidraw shape (smoke)', () => {
    // We don't run the real serializer here; instead we verify our wrapper
    // hands through whatever serializeAsJSON returns and that the contract
    // (parseable JSON object) is preserved.
    mockSerializeAsJSON.mockReturnValue(
      JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'jan',
        elements: [],
        appState: {},
        files: {},
      })
    )

    const out = exportCanvasToJson(makeCanvas())
    const parsed = JSON.parse(out)
    expect(parsed.type).toBe('excalidraw')
    expect(Array.isArray(parsed.elements)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// downloadBlob
// ---------------------------------------------------------------------------

describe('downloadBlob', () => {
  it('creates an anchor with download attribute and triggers click', async () => {
    const blob = new Blob(['x'], { type: 'application/octet-stream' })

    // jsdom doesn't ship URL.createObjectURL / revokeObjectURL — install them
    // as no-op shims first, then spy on the shims.
    const url = URL as unknown as {
      createObjectURL?: (b: Blob) => string
      revokeObjectURL?: (u: string) => void
    }
    const hadCreate = typeof url.createObjectURL === 'function'
    const hadRevoke = typeof url.revokeObjectURL === 'function'
    if (!hadCreate) url.createObjectURL = () => 'blob:fake'
    if (!hadRevoke) url.revokeObjectURL = () => {}

    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})

    // Spy on anchor.click to assert the download was triggered.
    const clickSpy = vi.fn()
    const origCreateElement = document.createElement.bind(document)
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = origCreateElement(tag) as HTMLElement
        if (tag === 'a') {
          ;(el as HTMLAnchorElement).click = clickSpy
        }
        return el
      })

    downloadBlob(blob, 'scene.png')

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    // Drain the deferred `URL.revokeObjectURL` setTimeout(0) so it fires
    // BEFORE we restore spies / remove the shim — otherwise the deferred
    // call lands on a deleted function and surfaces as an unhandled error.
    await new Promise((r) => setTimeout(r, 0))

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    createElementSpy.mockRestore()
    if (!hadCreate) delete url.createObjectURL
    if (!hadRevoke) delete url.revokeObjectURL
  })
})
