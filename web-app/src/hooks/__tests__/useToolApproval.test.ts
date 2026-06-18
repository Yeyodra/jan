import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolApproval } from '../useToolApproval'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolApproval: 'tool-approval-settings',
  },
}))

// Mock zustand persist
vi.mock('zustand/middleware', () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }),
}))

describe('useToolApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    useToolApproval.setState({
      approvedTools: {},
      allowAllMCPPermissions: false,
      isModalOpen: false,
      modalProps: null,
      pending: {},
      batchApprovalRequest: null,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useToolApproval())

    expect(result.current.approvedTools).toEqual({})
    expect(result.current.allowAllMCPPermissions).toBe(false)
    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.modalProps).toBe(null)
    expect(typeof result.current.approveToolForThread).toBe('function')
    expect(typeof result.current.isToolApproved).toBe('function')
    expect(typeof result.current.showApprovalModal).toBe('function')
    expect(typeof result.current.closeModal).toBe('function')
    expect(typeof result.current.setModalOpen).toBe('function')
    expect(typeof result.current.setAllowAllMCPPermissions).toBe('function')
  })

  describe('setAllowAllMCPPermissions', () => {
    it('should set allowAllMCPPermissions to true', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)
    })

    it('should set allowAllMCPPermissions to false', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setAllowAllMCPPermissions(true)
      })

      expect(result.current.allowAllMCPPermissions).toBe(true)

      act(() => {
        result.current.setAllowAllMCPPermissions(false)
      })

      expect(result.current.allowAllMCPPermissions).toBe(false)
    })
  })

  describe('approveToolForThread', () => {
    it('should approve a tool for a thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toContain('tool-a')
    })

    it('should approve multiple tools for the same thread', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-b')
        result.current.approveToolForThread('thread-1', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a', 'tool-b', 'tool-c'])
    })

    it('should approve tools for different threads independently', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-2', 'tool-b')
        result.current.approveToolForThread('thread-3', 'tool-c')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
      expect(result.current.approvedTools['thread-2']).toEqual(['tool-b'])
      expect(result.current.approvedTools['thread-3']).toEqual(['tool-c'])
    })

    it('should not duplicate tools when approving the same tool multiple times', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
    })
  })

  describe('isToolApproved', () => {
    it('should return false for non-approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(false)
    })

    it('should return true for approved tools', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-1', 'tool-a')
      expect(isApproved).toBe(true)
    })

    it('should return false for tools approved for different threads', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      const isApproved = result.current.isToolApproved('thread-2', 'tool-a')
      expect(isApproved).toBe(false)
    })
  })

  describe('closeModal', () => {
    it('should close the modal and reset props', () => {
      const { result } = renderHook(() => useToolApproval())

      // First set modal to open state
      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)

      // Then close the modal
      act(() => {
        result.current.closeModal()
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('setModalOpen', () => {
    it('should set modal open state to true', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.setModalOpen(true)
      })

      expect(result.current.isModalOpen).toBe(true)
    })

    it('should set modal open state to false and call closeModal', () => {
      const { result } = renderHook(() => useToolApproval())

      // Set up initial state
      act(() => {
        result.current.setModalOpen(true)
      })

      // Mock modalProps to verify they get reset
      useToolApproval.setState({
        modalProps: {
          toolName: 'test-tool',
          threadId: 'test-thread',
          onApprove: vi.fn(),
          onDeny: vi.fn(),
        },
      })

      // Set to false should trigger closeModal
      act(() => {
        result.current.setModalOpen(false)
      })

      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('showApprovalModal', () => {
    it('should return true immediately if tool is already approved', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First approve the tool
      act(() => {
        result.current.approveToolForThread('thread-1', 'tool-a')
      })

      // Then show approval modal
      let approvalResult: boolean
      await act(async () => {
        approvalResult = await result.current.showApprovalModal('tool-a', 'thread-1')
      })

      expect(approvalResult!).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
    })

    it('should open modal and set up modal props for non-approved tool', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Check that modal is open and props are set
      expect(result.current.isModalOpen).toBe(true)
      expect(result.current.modalProps).not.toBe(null)
      expect(result.current.modalProps?.toolName).toBe('tool-a')
      expect(result.current.modalProps?.threadId).toBe('thread-1')
      expect(typeof result.current.modalProps?.onApprove).toBe('function')
      expect(typeof result.current.modalProps?.onDeny).toBe('function')

      // Resolve by calling onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(false)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })

    it('should resolve with true when onApprove is called with allowOnce=true', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onApprove with allowOnce=true
      act(() => {
        result.current.modalProps?.onApprove(true)
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
      // Tool should NOT be added to approved tools when allowOnce=true
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(false)
    })

    it('should resolve with true and approve tool when onApprove is called with allowOnce=false', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onApprove with allowOnce=false
      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
      // Tool should be added to approved tools when allowOnce=false
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)
    })

    it('should resolve with false when onDeny is called', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start the async operation
      let approvalPromise: Promise<boolean>

      act(() => {
        approvalPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      // Call onDeny
      act(() => {
        result.current.modalProps?.onDeny()
      })

      const approvalResult = await approvalPromise!
      expect(approvalResult).toBe(false)
      expect(result.current.isModalOpen).toBe(false)
      expect(result.current.modalProps).toBe(null)
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useToolApproval())
      const { result: result2 } = renderHook(() => useToolApproval())

      act(() => {
        result1.current.approveToolForThread('thread-1', 'tool-a')
        result1.current.setAllowAllMCPPermissions(true)
      })

      expect(result2.current.approvedTools['thread-1']).toContain('tool-a')
      expect(result2.current.allowAllMCPPermissions).toBe(true)
    })
  })

  describe('requestBatchApproval', () => {
    beforeEach(() => {
      useToolApproval.setState({
        batchApprovalRequest: null,
        pending: {},
      })
    })

    it('should expose requestBatchApproval and resolveBatchApproval as functions', () => {
      const { result } = renderHook(() => useToolApproval())
      expect(typeof result.current.requestBatchApproval).toBe('function')
      expect(typeof result.current.resolveBatchApproval).toBe('function')
    })

    it('should set batchApprovalRequest in store when called', () => {
      const { result } = renderHook(() => useToolApproval())

      act(() => {
        result.current.requestBatchApproval('canvas-1', { mutating: 3, readonly: 2 })
      })

      expect(result.current.batchApprovalRequest).not.toBe(null)
      expect(result.current.batchApprovalRequest?.canvasId).toBe('canvas-1')
      expect(result.current.batchApprovalRequest?.mutating).toBe(3)
      expect(result.current.batchApprovalRequest?.readonly).toBe(2)
      expect(typeof result.current.batchApprovalRequest?.resolve).toBe('function')
    })

    it('should resolve with "approve-all" when resolveBatchApproval called with approve-all', async () => {
      const { result } = renderHook(() => useToolApproval())

      let batchPromise: Promise<'approve-all' | 'per-call' | 'cancel'>
      act(() => {
        batchPromise = result.current.requestBatchApproval('canvas-1', { mutating: 2, readonly: 1 })
      })

      act(() => {
        result.current.resolveBatchApproval('approve-all')
      })

      const choice = await batchPromise!
      expect(choice).toBe('approve-all')
      expect(result.current.batchApprovalRequest).toBe(null)
    })

    it('should resolve with "per-call" when resolveBatchApproval called with per-call', async () => {
      const { result } = renderHook(() => useToolApproval())

      let batchPromise: Promise<'approve-all' | 'per-call' | 'cancel'>
      act(() => {
        batchPromise = result.current.requestBatchApproval('canvas-1', { mutating: 2, readonly: 1 })
      })

      act(() => {
        result.current.resolveBatchApproval('per-call')
      })

      const choice = await batchPromise!
      expect(choice).toBe('per-call')
      expect(result.current.batchApprovalRequest).toBe(null)
    })

    it('should resolve with "cancel" when resolveBatchApproval called with cancel', async () => {
      const { result } = renderHook(() => useToolApproval())

      let batchPromise: Promise<'approve-all' | 'per-call' | 'cancel'>
      act(() => {
        batchPromise = result.current.requestBatchApproval('canvas-1', { mutating: 2, readonly: 1 })
      })

      act(() => {
        result.current.resolveBatchApproval('cancel')
      })

      const choice = await batchPromise!
      expect(choice).toBe('cancel')
      expect(result.current.batchApprovalRequest).toBe(null)
    })

    it('should not interfere with per-call requestApproval (both can coexist)', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Start a batch approval
      let batchPromise: Promise<'approve-all' | 'per-call' | 'cancel'>
      act(() => {
        batchPromise = result.current.requestBatchApproval('canvas-1', { mutating: 1, readonly: 0 })
      })

      // Also start a per-call approval
      let perCallPromise: Promise<boolean>
      act(() => {
        perCallPromise = result.current.requestApproval('call-1', 'myTool', 'thread-1')
      })

      // Both are pending simultaneously
      expect(result.current.batchApprovalRequest).not.toBe(null)
      expect(result.current.pending['call-1']).not.toBeUndefined()

      // Resolve batch
      act(() => {
        result.current.resolveBatchApproval('approve-all')
      })
      expect(await batchPromise!).toBe('approve-all')
      expect(result.current.batchApprovalRequest).toBe(null)

      // Per-call still pending
      expect(result.current.pending['call-1']).not.toBeUndefined()

      // Resolve per-call
      act(() => {
        result.current.resolveApproval('call-1', 'allow-once')
      })
      expect(await perCallPromise!).toBe(true)
      expect(result.current.pending['call-1']).toBeUndefined()
    })

    it('should do nothing when resolveBatchApproval called with no pending request', () => {
      const { result } = renderHook(() => useToolApproval())
      // Should not throw
      act(() => {
        result.current.resolveBatchApproval('cancel')
      })
      expect(result.current.batchApprovalRequest).toBe(null)
    })
  })

  describe('complex scenarios', () => {
    it('should handle multiple sequential approval requests', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First request
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const firstResult = await firstPromise!
      expect(firstResult).toBe(true)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)

      // Second request for same tool should resolve immediately
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBe(true)
      expect(result.current.isModalOpen).toBe(false)
    })

    it('should handle approval for different tools in same thread', async () => {
      const { result } = renderHook(() => useToolApproval())

      // Approve tool-a permanently
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      await firstPromise!
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)

      // Approve tool-b once only
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-b', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(true)
      })

      await secondPromise!
      expect(result.current.isToolApproved('thread-1', 'tool-b')).toBe(false)

      // Verify final state
      expect(result.current.approvedTools['thread-1']).toEqual(['tool-a'])
    })

    it('should handle denial and subsequent approval', async () => {
      const { result } = renderHook(() => useToolApproval())

      // First request - deny
      let firstPromise: Promise<boolean>
      act(() => {
        firstPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onDeny()
      })

      const firstResult = await firstPromise!
      expect(firstResult).toBe(false)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(false)

      // Second request - approve
      let secondPromise: Promise<boolean>
      act(() => {
        secondPromise = result.current.showApprovalModal('tool-a', 'thread-1')
      })

      act(() => {
        result.current.modalProps?.onApprove(false)
      })

      const secondResult = await secondPromise!
      expect(secondResult).toBe(true)
      expect(result.current.isToolApproved('thread-1', 'tool-a')).toBe(true)
    })
  })
})
