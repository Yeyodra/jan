/**
 * Tests for tool-call dispatch (T15) — `dispatchExcalidrawTool` helper.
 *
 * The helper enforces three gates in order:
 *   1. Curated allow-list (`EXCALIDRAW_ALLOWED_TOOLS`). Blocked or unknown
 *      tools are rejected without invoking the approval gate OR the wire
 *      transport.
 *   2. T21 user approval (`approvalGate(toolName, threadId, params)`). Only
 *      consulted for tools in `EXCALIDRAW_MUTATING_TOOLS`. Readonly tools
 *      bypass approval entirely.
 *   3. mcp_excalidraw transport (`mcpClient.callTool(call)`). Result is
 *      normalized into the discriminated `McpToolResult` envelope:
 *        - success → `{ content: [...] }`
 *        - wire error (`isError: true` OR top-level `error`) → `{ error: '...' }`
 *        - transport throw → `{ error: '<message>' }` (never re-thrown)
 *
 * Style follows `web-app/src/lib/canvas-mcp-orchestrator/active-canvas.test.ts`:
 *   - Pure DI; no React, no zustand, no router.
 *   - Each test asserts the call-count of every gate so silent over-invocation
 *     is impossible.
 */
import { describe, it, expect, vi } from 'vitest'

import {
  dispatchExcalidrawTool,
  type DispatchDeps,
  type ApprovalGateFn,
  type DispatchMcpClientLike,
} from './dispatch'
import type { McpToolCall, McpToolResult } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THREAD_ID = 'thread-test-1'

const makeApprovalGate = (decision: boolean): ApprovalGateFn & {
  mock: ReturnType<typeof vi.fn>
} => {
  const mock = vi.fn(async () => decision)
  const fn = ((toolName: string, threadId: string, params?: Record<string, unknown>) =>
    mock(toolName, threadId, params)) as ApprovalGateFn & {
    mock: ReturnType<typeof vi.fn>
  }
  fn.mock = mock
  return fn
}

const makeMcpClient = (
  impl: (call: McpToolCall) => Promise<unknown> | unknown,
): DispatchMcpClientLike & { callTool: ReturnType<typeof vi.fn> } => {
  const callTool = vi.fn(impl)
  return { callTool } as unknown as DispatchMcpClientLike & {
    callTool: ReturnType<typeof vi.fn>
  }
}

const makeDeps = (
  overrides: Partial<DispatchDeps> = {},
): DispatchDeps => ({
  mcpClient: makeMcpClient(async () => ({
    content: [{ type: 'text', text: 'ok' }],
  })),
  approvalGate: makeApprovalGate(true),
  threadId: THREAD_ID,
  ...overrides,
})

// ---------------------------------------------------------------------------
// 1. Curated allow-list gate
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — allow-list gate', () => {
  it('rejects a blocked tool (export_to_image) without invoking approval or mcp', async () => {
    const approvalGate = makeApprovalGate(true)
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'export_to_image', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'tool not available in this build' })
    expect(approvalGate.mock).not.toHaveBeenCalled()
    expect(mcpClient.callTool).not.toHaveBeenCalled()
  })

  it('rejects an unknown tool the same way (closed allow-list)', async () => {
    const approvalGate = makeApprovalGate(true)
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'totally_unknown_tool', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'tool not available in this build' })
    expect(approvalGate.mock).not.toHaveBeenCalled()
    expect(mcpClient.callTool).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 2. Approval gate (mutating tools)
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — approval gate', () => {
  it('forwards a mutating tool when approval is granted', async () => {
    const approvalGate = makeApprovalGate(true)
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'created' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const call: McpToolCall = {
      name: 'create_element',
      arguments: { type: 'rectangle', x: 0, y: 0 },
    }
    const result = await dispatchExcalidrawTool(call, deps)

    expect(approvalGate.mock).toHaveBeenCalledTimes(1)
    expect(approvalGate.mock).toHaveBeenCalledWith(
      'create_element',
      THREAD_ID,
      call.arguments,
    )
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1)
    expect(mcpClient.callTool).toHaveBeenCalledWith(call)
    expect(result).toEqual({ content: [{ type: 'text', text: 'created' }] })
  })

  it('returns "user denied tool call" when approval is denied and does NOT invoke mcp', async () => {
    const approvalGate = makeApprovalGate(false)
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'create_element', arguments: { type: 'rectangle' } },
      deps,
    )

    expect(result).toEqual({ error: 'user denied tool call' })
    expect(approvalGate.mock).toHaveBeenCalledTimes(1)
    expect(mcpClient.callTool).not.toHaveBeenCalled()
  })

  it('fails closed when no approvalGate is configured for a mutating tool', async () => {
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
    }))
    const warn = vi.fn()
    const telemetry = { increment: vi.fn(), timing: vi.fn() }
    const deps: DispatchDeps = {
      mcpClient,
      approvalGate: undefined,
      threadId: THREAD_ID,
      logger: { warn, debug: vi.fn() },
      telemetry,
    }

    const result = await dispatchExcalidrawTool(
      { name: 'clear_canvas', arguments: {} },
      deps,
    )

    expect(result).toEqual({
      error: 'tool requires approval but no gate configured',
    })
    expect(mcpClient.callTool).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(telemetry.increment).toHaveBeenCalledWith(
      'dispatch.approval_gate_missing',
    )
  })
})

// ---------------------------------------------------------------------------
// 3. Read-only tools bypass approval
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — readonly bypass', () => {
  it('does NOT invoke the approval gate for a readonly tool', async () => {
    const approvalGate = makeApprovalGate(false /* would deny if asked */)
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: '{"elements":[]}' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: { filter: 'all' } },
      deps,
    )

    expect(approvalGate.mock).not.toHaveBeenCalled()
    expect(mcpClient.callTool).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      content: [{ type: 'text', text: '{"elements":[]}' }],
    })
  })

  it('readonly tool works even when no approvalGate is configured', async () => {
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'ok' }],
    }))
    const deps: DispatchDeps = {
      mcpClient,
      approvalGate: undefined,
      threadId: THREAD_ID,
    }

    const result = await dispatchExcalidrawTool(
      { name: 'describe_scene', arguments: {} },
      deps,
    )

    expect(mcpClient.callTool).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })
})

// ---------------------------------------------------------------------------
// 4. Wire-shape marshalling
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — wire marshalling', () => {
  it('passes through the success content array unchanged', async () => {
    const content = [
      { type: 'text' as const, text: 'first' },
      { type: 'text' as const, text: 'second' },
    ]
    const mcpClient = makeMcpClient(async () => ({ content }))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ content })
  })

  it('normalizes wire-level isError:true into { error } using first content text', async () => {
    const mcpClient = makeMcpClient(async () => ({
      isError: true,
      content: [{ type: 'text', text: 'tool blew up server-side' }],
    }))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'tool blew up server-side' })
  })

  it('normalizes wire-level top-level error string into { error }', async () => {
    const mcpClient = makeMcpClient(async () => ({
      error: 'flat error envelope',
      content: [],
    }))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'flat error envelope' })
  })

  it('isError:true with empty content falls back to a generic error message', async () => {
    const mcpClient = makeMcpClient(async () => ({
      isError: true,
      content: [],
    }))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toMatch(/error/i)
  })

  it('drops extra fields on the success envelope (does not widen McpToolResult)', async () => {
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      // Extra fields the wire may emit — must not leak.
      _meta: { requestId: 'abc' },
      structured: { foo: 'bar' },
    }))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(Object.keys(result)).toEqual(['content'])
  })
})

// ---------------------------------------------------------------------------
// 5. Transport failure
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — transport failures', () => {
  it('catches a thrown transport error and returns { error: <message> }', async () => {
    const mcpClient = makeMcpClient(async () => {
      throw new Error('socket closed')
    })
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'socket closed' })
  })

  it('catches non-Error throw values and stringifies them', async () => {
    const mcpClient = makeMcpClient(async () => {
      throw 'string thrown'
    })
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'string thrown' })
  })

  it('never re-throws even when the approval gate itself rejects', async () => {
    const approvalGate: ApprovalGateFn = async () => {
      throw new Error('gate exploded')
    }
    const mcpClient = makeMcpClient(async () => ({
      content: [{ type: 'text', text: 'should-not-run' }],
    }))
    const deps = makeDeps({ approvalGate, mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'create_element', arguments: {} },
      deps,
    )

    expect(result).toEqual({ error: 'gate exploded' })
    expect(mcpClient.callTool).not.toHaveBeenCalled()
  })

  it('marshals wire result that is missing content into a generic error', async () => {
    const mcpClient = makeMcpClient(async () => ({}))
    const deps = makeDeps({ mcpClient })

    const result = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )

    expect(result).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// 6. Type-level: the return shape is exactly McpToolResult
// ---------------------------------------------------------------------------

describe('dispatchExcalidrawTool — type discipline', () => {
  it('returns a value structurally compatible with McpToolResult', async () => {
    const deps = makeDeps()
    const result: McpToolResult = await dispatchExcalidrawTool(
      { name: 'query_elements', arguments: {} },
      deps,
    )
    // Either branch of the union is acceptable; the assignment above is the
    // real assertion. Add a runtime guard so the test still does something.
    expect('content' in result || 'error' in result).toBe(true)
  })
})
