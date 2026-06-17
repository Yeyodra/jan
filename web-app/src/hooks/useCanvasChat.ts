import { useRef, useCallback } from 'react'
import { useChat } from '@/hooks/use-chat'
import { getExcalidrawCuratedToolDefinitions } from '@/lib/canvas-mcp-orchestrator/curated-tools'
import type { McpToolCall } from '@/lib/canvas-mcp-orchestrator/types'
import type { ModelInfo } from '@janhq/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * System prompt injected for every canvas LLM session.
 * Kept narrow — the orchestrator owns drawing-tool invocation policy.
 */
const CANVAS_SYSTEM_PROMPT =
  'You are an AI assistant helping draw on an Excalidraw canvas. Use only the provided drawing tools.'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanvasChatStatus = 'idle' | 'submitting' | 'streaming' | 'error'

export type UseCanvasChatOptions = {
  canvasId: string
  model: ModelInfo
  provider: string
  onToolCall?: (call: McpToolCall) => void
  onFinish?: () => void
}

export type UseCanvasChatResult = {
  sendMessage: (prompt: string) => void
  stop: () => void
  status: CanvasChatStatus
  error: Error | null
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Maps Vercel AI SDK `useChatSDK` status values to the narrow canvas-facing
 * status enum. The SDK status is a superset; we collapse it down to the four
 * states the canvas UI needs.
 *
 * SDK statuses: 'submitted' | 'streaming' | 'ready' | 'error'
 */
function mapStatus(sdkStatus: string): CanvasChatStatus {
  switch (sdkStatus) {
    case 'submitted':
      return 'submitting'
    case 'streaming':
      return 'streaming'
    case 'error':
      return 'error'
    default:
      // 'ready' and any unknown future status → idle
      return 'idle'
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around `useChat` for canvas LLM dispatch.
 *
 * Design constraints:
 *   - Session ID is prefixed `canvas-` to avoid collision with chat threads.
 *   - Tool definitions are derived from `EXCALIDRAW_ALLOWED_TOOLS` via
 *     `getExcalidrawCuratedToolDefinitions()` — never hardcoded separately.
 *   - Transport is NOT recreated on every render (mirrors `transportRef`
 *     pattern from `$threadId.tsx`; the ref is owned by `useChat` internally).
 *   - `messages` array is NOT exposed — callers only need dispatch primitives.
 *   - `@excalidraw/excalidraw` is NOT imported here (lazy-load boundary).
 *
 * @param options - Canvas-specific configuration
 * @returns Minimal dispatch API: sendMessage, stop, status, error
 */
export function useCanvasChat(options: UseCanvasChatOptions): UseCanvasChatResult {
  const { canvasId, onToolCall, onFinish } = options

  // Stable ref for tool definitions — computed once, never recreated on render.
  // `getExcalidrawCuratedToolDefinitions()` is pure and returns the same shape
  // every call, but wrapping in a ref avoids any re-instantiation cost.
  const toolDefsRef = useRef<ReturnType<typeof getExcalidrawCuratedToolDefinitions> | null>(null)
  if (!toolDefsRef.current) {
    toolDefsRef.current = getExcalidrawCuratedToolDefinitions()
  }

  // Stable ref for onToolCall callback — lets the onToolCall handler below
  // always call the latest callback without re-creating the handler on render.
  const onToolCallRef = useRef(onToolCall)
  onToolCallRef.current = onToolCall

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  const {
    sendMessage: chatSendMessage,
    stop: chatStop,
    status: sdkStatus,
    error: sdkError,
  } = useChat({
    // canvas- prefix is critical — must not collide with chat thread session IDs
    sessionId: 'canvas-' + canvasId,
    systemMessage: CANVAS_SYSTEM_PROMPT,
    onFinish: () => {
      onFinishRef.current?.()
    },
  })

  /**
   * Send a plain text prompt to the canvas LLM.
   * Wraps `useChat`'s `sendMessage` which accepts a `{ text }` part or string.
   */
  const sendMessage = useCallback(
    (prompt: string) => {
      chatSendMessage({ role: 'user', parts: [{ type: 'text', text: prompt }] })
    },
    [chatSendMessage]
  )

  const stop = useCallback(() => {
    chatStop()
  }, [chatStop])

  return {
    sendMessage,
    stop,
    status: mapStatus(sdkStatus),
    error: sdkError ?? null,
  }
}
