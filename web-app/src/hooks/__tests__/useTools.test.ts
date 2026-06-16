import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SystemEvent } from '@/types/events'

// Mock functions
const mockGetTools = vi.fn()
const mockUpdateTools = vi.fn()
const mockUpdateRagToolNames = vi.fn()
const mockUpdateMcpToolNames = vi.fn()
const mockUpdateCanvasToolNames = vi.fn()
const mockListen = vi.fn()
const mockUnsubscribe = vi.fn()

// Mock useAppState — provide every updater the hook subscribes to so the
// selector always returns a callable. Missing updaters would throw inside the
// effect and silently swallow assertions further down the call chain.
vi.mock('../useAppState', () => ({
  useAppState: (selector: any) =>
    selector({
      updateTools: mockUpdateTools,
      updateRagToolNames: mockUpdateRagToolNames,
      updateMcpToolNames: mockUpdateMcpToolNames,
      updateCanvasToolNames: mockUpdateCanvasToolNames,
    }),
}))

// Mock canvas built-in tools so the test does not depend on T18 internals.
vi.mock('@/lib/canvas/ai-tools', () => ({
  canvasBuiltinTools: [
    {
      name: 'canvas_list',
      description: 'List canvases',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      server: 'canvas',
      handler: vi.fn(),
    },
  ],
  CANVAS_TOOL_SERVER: 'canvas',
}))

// Mock the ServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      getTools: mockGetTools,
    }),
    rag: () => ({
      getToolNames: vi.fn(() => Promise.resolve([])),
    }),
    events: () => ({
      listen: mockListen,
    }),
  }),
}))

describe('useTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListen.mockResolvedValue(mockUnsubscribe)
    mockGetTools.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call getTools and updateTools on mount', async () => {
    const { useTools } = await import('../useTools')
    
    const mockTools = [
      { name: 'test-tool', description: 'A test tool' },
      { name: 'another-tool', description: 'Another test tool' },
    ]
    mockGetTools.mockResolvedValue(mockTools)

    renderHook(() => useTools())

    // Wait for async operations to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    // updateTools is now called with [...mcpTools, ...canvasBuiltinTools]
    expect(mockUpdateTools).toHaveBeenCalledTimes(1)
    const passed = mockUpdateTools.mock.calls[0][0]
    expect(passed).toEqual(
      expect.arrayContaining([
        ...mockTools,
        expect.objectContaining({ name: 'canvas_list', server: 'canvas' }),
      ])
    )
    expect(mockUpdateCanvasToolNames).toHaveBeenCalledWith(['canvas_list'])
  })

  it('should set up event listener for MCP_UPDATE', async () => {
    const { useTools } = await import('../useTools')
    
    renderHook(() => useTools())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockListen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
  })

  it('should call setTools when MCP_UPDATE event is triggered', async () => {
    const { useTools } = await import('../useTools')
    
    const mockTools = [{ name: 'updated-tool', description: 'Updated tool' }]
    mockGetTools.mockResolvedValue(mockTools)

    let eventCallback: () => void

    mockListen.mockImplementation((_event, callback) => {
      eventCallback = callback
      return Promise.resolve(mockUnsubscribe)
    })

    renderHook(() => useTools())

    // Wait for initial setup
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    // Clear the initial calls
    vi.clearAllMocks()
    mockGetTools.mockResolvedValue(mockTools)

    // Trigger the event
    await act(async () => {
      eventCallback()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    // After MCP_UPDATE: updateTools called with merged set including canvas tools
    expect(mockUpdateTools).toHaveBeenCalledTimes(1)
    const passed = mockUpdateTools.mock.calls[0][0]
    expect(passed).toEqual(
      expect.arrayContaining([
        ...mockTools,
        expect.objectContaining({ name: 'canvas_list', server: 'canvas' }),
      ])
    )
  })

  it('should return unsubscribe function for cleanup', async () => {
    const { useTools } = await import('../useTools')
    
    const { unmount } = renderHook(() => useTools())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    expect(mockListen).toHaveBeenCalled()

    // Unmount should call the unsubscribe function
    unmount()

    expect(mockListen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
  })

  it('should handle getTools errors gracefully', async () => {
    const { useTools } = await import('../useTools')
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetTools.mockRejectedValue(new Error('Failed to get tools'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mockGetTools).toHaveBeenCalledTimes(1)
    // updateTools should not be called if getTools fails (Promise.all rejects
    // before we reach the merge step)
    expect(mockUpdateTools).not.toHaveBeenCalled()
    expect(mockUpdateCanvasToolNames).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should handle event listener setup errors gracefully', async () => {
    const { useTools } = await import('../useTools')
    
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockListen.mockRejectedValue(new Error('Failed to set up listener'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Initial getTools should still work
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should only set up effect once with empty dependency array', async () => {
    const { useTools } = await import('../useTools')
    
    const { rerender } = renderHook(() => useTools())

    // Initial render
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledTimes(1)

    // Rerender should not trigger additional calls
    rerender()
    expect(mockGetTools).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledTimes(1)
  })
})
