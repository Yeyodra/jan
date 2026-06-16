/**
 * Unit tests for `@/lib/canvas/file-io`.
 *
 * Strategy:
 *   - Mock `@/lib/platform/utils` so we control `isPlatformTauri` per test.
 *   - Mock `@/hooks/useServiceHub` so we control dialog/core invocations
 *     and assert exactly which args are passed to `write_file_sync` /
 *     `read_file_sync`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks (must be declared before importing the module under test)
// ---------------------------------------------------------------------------

const mockIsPlatformTauri = vi.fn<[], boolean>()
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => mockIsPlatformTauri(),
}))

const mockDialogSave = vi.fn()
const mockDialogOpen = vi.fn()
const mockCoreInvoke = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    dialog: () => ({
      save: mockDialogSave,
      open: mockDialogOpen,
    }),
    core: () => ({
      invoke: mockCoreInvoke,
    }),
  }),
}))

import {
  isFileIoAvailable,
  saveCanvasFile,
  openExcalidrawFile,
} from './file-io'

beforeEach(() => {
  mockIsPlatformTauri.mockReset()
  mockDialogSave.mockReset()
  mockDialogOpen.mockReset()
  mockCoreInvoke.mockReset()
})

// ---------------------------------------------------------------------------
// isFileIoAvailable
// ---------------------------------------------------------------------------

describe('isFileIoAvailable', () => {
  it('returns true when running under Tauri', () => {
    mockIsPlatformTauri.mockReturnValue(true)
    expect(isFileIoAvailable()).toBe(true)
  })

  it('returns false when not running under Tauri', () => {
    mockIsPlatformTauri.mockReturnValue(false)
    expect(isFileIoAvailable()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// saveCanvasFile
// ---------------------------------------------------------------------------

describe('saveCanvasFile', () => {
  it('throws errors.fileIoUnavailable when not on Tauri', async () => {
    mockIsPlatformTauri.mockReturnValue(false)
    await expect(
      saveCanvasFile({
        defaultName: 'scene',
        format: 'svg',
        data: '<svg/>',
      })
    ).rejects.toThrow(/errors\.fileIoUnavailable/)
    expect(mockDialogSave).not.toHaveBeenCalled()
    expect(mockCoreInvoke).not.toHaveBeenCalled()
  })

  it('appends the format extension when missing and writes to picked path (svg)', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogSave.mockResolvedValue('/tmp/out/scene.svg')
    mockCoreInvoke.mockResolvedValue(undefined)

    const path = await saveCanvasFile({
      defaultName: 'scene',
      format: 'svg',
      data: '<svg/>',
    })

    expect(path).toBe('/tmp/out/scene.svg')
    expect(mockDialogSave).toHaveBeenCalledTimes(1)
    const dialogArg = mockDialogSave.mock.calls[0][0] as {
      defaultPath: string
      filters: Array<{ name: string; extensions: string[] }>
    }
    expect(dialogArg.defaultPath).toBe('scene.svg')
    expect(dialogArg.filters[0].extensions).toEqual(['svg'])

    expect(mockCoreInvoke).toHaveBeenCalledTimes(1)
    expect(mockCoreInvoke).toHaveBeenCalledWith('write_file_sync', {
      args: ['/tmp/out/scene.svg', '<svg/>'],
    })
  })

  it('preserves a defaultName that already has the extension', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogSave.mockResolvedValue('/tmp/x.json')
    mockCoreInvoke.mockResolvedValue(undefined)

    await saveCanvasFile({
      defaultName: 'mydata.json',
      format: 'json',
      data: '{"k":1}',
    })

    const dialogArg = mockDialogSave.mock.calls[0][0] as { defaultPath: string }
    expect(dialogArg.defaultPath).toBe('mydata.json')
  })

  it('returns null when the user cancels the save dialog (no write attempted)', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogSave.mockResolvedValue(null)

    const result = await saveCanvasFile({
      defaultName: 'x',
      format: 'svg',
      data: '<svg/>',
    })

    expect(result).toBeNull()
    expect(mockCoreInvoke).not.toHaveBeenCalled()
  })

  it('throws when format is png (binary export not yet supported via Tauri)', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogSave.mockResolvedValue('/tmp/x.png')

    const blob = new Blob(['png'], { type: 'image/png' })
    await expect(
      saveCanvasFile({
        defaultName: 'x',
        format: 'png',
        data: blob,
      })
    ).rejects.toThrow(/errors\.saveBinaryUnsupported/)
    // Dialog opened, but the write must not happen for PNG.
    expect(mockCoreInvoke).not.toHaveBeenCalled()
  })

  it('decodes a Blob payload to UTF-8 text for text formats', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogSave.mockResolvedValue('/tmp/out.svg')
    mockCoreInvoke.mockResolvedValue(undefined)

    // jsdom's Blob doesn't implement `.text()` — provide a minimal stand-in
    // that resolves to the underlying string. The production code only calls
    // `data.text()` so a stub on the instance is enough.
    const text = '<svg>blob-text</svg>'
    const blob = new Blob([text], { type: 'image/svg+xml' }) as Blob & {
      text: () => Promise<string>
    }
    if (typeof blob.text !== 'function') {
      blob.text = async () => text
    }

    await saveCanvasFile({
      defaultName: 'out',
      format: 'svg',
      data: blob,
    })

    expect(mockCoreInvoke).toHaveBeenCalledWith('write_file_sync', {
      args: ['/tmp/out.svg', '<svg>blob-text</svg>'],
    })
  })
})

// ---------------------------------------------------------------------------
// openExcalidrawFile
// ---------------------------------------------------------------------------

describe('openExcalidrawFile', () => {
  it('throws errors.fileIoUnavailable when not on Tauri', async () => {
    mockIsPlatformTauri.mockReturnValue(false)
    await expect(openExcalidrawFile()).rejects.toThrow(
      /errors\.fileIoUnavailable/
    )
  })

  it('parses a valid .excalidraw file and returns the imported canvas', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue('/abs/path/MyDrawing.excalidraw')
    const fileText = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'jan',
      elements: [{ id: 'a', type: 'rectangle' }],
      appState: { viewBackgroundColor: '#ddd' },
      files: {},
    })
    mockCoreInvoke.mockResolvedValue(fileText)

    const result = await openExcalidrawFile()

    expect(result).not.toBeNull()
    expect(result!.path).toBe('/abs/path/MyDrawing.excalidraw')
    expect(result!.canvas.name).toBe('MyDrawing')
    expect(result!.canvas.elements).toHaveLength(1)
    expect(result!.canvas.appState.viewBackgroundColor).toBe('#ddd')
    expect(mockCoreInvoke).toHaveBeenCalledWith('read_file_sync', {
      args: ['/abs/path/MyDrawing.excalidraw'],
    })
  })

  it('also handles a Windows path separator when deriving the name', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue('C:\\Users\\me\\My Scene.excalidraw')
    mockCoreInvoke.mockResolvedValue(
      JSON.stringify({ type: 'excalidraw', version: 2, elements: [] })
    )

    const result = await openExcalidrawFile()
    expect(result!.canvas.name).toBe('My Scene')
  })

  it('returns null when the open dialog is cancelled', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue(null)

    const result = await openExcalidrawFile()
    expect(result).toBeNull()
    expect(mockCoreInvoke).not.toHaveBeenCalled()
  })

  it('throws errors.importParseError when the file is not valid JSON', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue('/x/bad.excalidraw')
    mockCoreInvoke.mockResolvedValue('this is not json')

    await expect(openExcalidrawFile()).rejects.toThrow(
      /errors\.importParseError/
    )
  })

  it('throws errors.importParseError when JSON is missing required fields', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue('/x/wrong.excalidraw')
    // Valid JSON but wrong shape — no `type: "excalidraw"`, no `elements`.
    mockCoreInvoke.mockResolvedValue(JSON.stringify({ foo: 'bar' }))

    await expect(openExcalidrawFile()).rejects.toThrow(
      /errors\.importParseError/
    )
  })

  it('handles dialog returning string[] by taking the first entry', async () => {
    mockIsPlatformTauri.mockReturnValue(true)
    mockDialogOpen.mockResolvedValue(['/x/a.excalidraw', '/x/b.excalidraw'])
    mockCoreInvoke.mockResolvedValue(
      JSON.stringify({ type: 'excalidraw', version: 2, elements: [] })
    )

    const result = await openExcalidrawFile()
    expect(result!.path).toBe('/x/a.excalidraw')
    expect(result!.canvas.name).toBe('a')
  })
})
