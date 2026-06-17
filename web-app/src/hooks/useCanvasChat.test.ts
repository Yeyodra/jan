import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasChat } from './useCanvasChat'
import { useChat } from '@/hooks/use-chat'

// ---------------------------------------------------------------------------
// Mock useChat — we test the wrapper, not the underlying hook
// ---------------------------------------------------------------------------

const mockSendMessage = vi.fn()
const mockStop = vi.fn()
let mockStatus = 'ready'
let mockError: Error | null = null

vi.mock('@/hooks/use-chat', () => ({
  useChat: vi.fn(() => ({
    sendMessage: mockSendMessage,
    stop: mockStop,
    status: mockStatus,
    error: mockError,
    messages: [],
    updateRagToolsAvailability: vi.fn(),
    setContinueFromContent: vi.fn(),
  })),
}))

const mockedUseChat = vi.mocked(useChat)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultOpts = {
  canvasId: 'canvas-abc-123',
  model: { id: 'test-model' } as any,
  provider: 'llamacpp',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCanvasChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatus = 'ready'
    mockError = null
  })

  it('renders without crashing and returns expected shape', () => {
    const { result } = renderHook(() => useCanvasChat(defaultOpts))

    expect(result.current).toMatchObject({
      sendMessage: expect.any(Function),
      stop: expect.any(Function),
      status: 'idle',
      error: null,
    })
  })

  it('does NOT expose messages array', () => {
    const { result } = renderHook(() => useCanvasChat(defaultOpts))
    expect((result.current as any).messages).toBeUndefined()
  })

  it('sendMessage calls useChat append with text part', () => {
    const { result } = renderHook(() => useCanvasChat(defaultOpts))

    act(() => {
      result.current.sendMessage('draw a circle')
    })

    expect(mockSendMessage).toHaveBeenCalledOnce()
    expect(mockSendMessage).toHaveBeenCalledWith({
      role: 'user',
      parts: [{ type: 'text', text: 'draw a circle' }],
    })
  })

  it('stop calls useChat stop', () => {
    const { result } = renderHook(() => useCanvasChat(defaultOpts))

    act(() => {
      result.current.stop()
    })

    expect(mockStop).toHaveBeenCalledOnce()
  })

  describe('status mapping', () => {
    it('maps "ready" → "idle"', () => {
      mockStatus = 'ready'
      const { result } = renderHook(() => useCanvasChat(defaultOpts))
      expect(result.current.status).toBe('idle')
    })

    it('maps "submitted" → "submitting"', () => {
      mockStatus = 'submitted'
      const { result } = renderHook(() => useCanvasChat(defaultOpts))
      expect(result.current.status).toBe('submitting')
    })

    it('maps "streaming" → "streaming"', () => {
      mockStatus = 'streaming'
      const { result } = renderHook(() => useCanvasChat(defaultOpts))
      expect(result.current.status).toBe('streaming')
    })

    it('maps "error" → "error"', () => {
      mockStatus = 'error'
      const { result } = renderHook(() => useCanvasChat(defaultOpts))
      expect(result.current.status).toBe('error')
    })

    it('maps unknown status → "idle"', () => {
      mockStatus = 'some-future-status'
      const { result } = renderHook(() => useCanvasChat(defaultOpts))
      expect(result.current.status).toBe('idle')
    })
  })

  it('surfaces error from useChat', () => {
    const err = new Error('stream failed')
    mockError = err
    const { result } = renderHook(() => useCanvasChat(defaultOpts))
    expect(result.current.error).toBe(err)
  })

  it('uses canvas- prefixed sessionId to avoid chat thread collision', () => {
    renderHook(() => useCanvasChat({ ...defaultOpts, canvasId: 'xyz' }))
    const callArgs = mockedUseChat.mock.calls[0][0]
    expect(callArgs?.sessionId).toBe('canvas-xyz')
  })

  it('calls onFinish when stream ends', () => {
    const onFinish = vi.fn()
    renderHook(() => useCanvasChat({ ...defaultOpts, onFinish }))

    // Grab the onFinish passed to useChat and invoke it
    const useChatOpts = mockedUseChat.mock.calls[0][0]
    act(() => {
      useChatOpts?.onFinish?.()
    })

    expect(onFinish).toHaveBeenCalledOnce()
  })
})
