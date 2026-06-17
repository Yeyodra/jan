/**
 * Tests for `translateMcpToolResult` — MCP tool-result → CanvasMutation[].
 *
 * Wire shapes are pinned to the vendored mcp_excalidraw source at
 * `src-tauri/resources/mcp_excalidraw/src/index.ts`:
 *
 *   create_element        → text starts with "Element created successfully!\n\n<json>"
 *   update_element        → text starts with "Element updated successfully!\n\n<json>"
 *   delete_element        → text starts with "Element deleted successfully!\n\n<json>"
 *   batch_create_elements → text starts with "<n> elements created successfully!\n\n<json>"
 *
 * The translator may also be invoked with an explicit `toolName` to skip
 * prose-sniffing — this is the preferred path when the caller knows it.
 */
import { describe, it, expect, vi } from 'vitest'
import { translateMcpToolResult } from './result-translator'
import { createIdTranslator, MCP_ID_PREFIX } from './id-translation'
import type { McpToolResult, CanvasMutation } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTranslator() {
  let n = 0
  return createIdTranslator({ generateId: () => `canvas-${++n}` })
}

/**
 * Build a wire-shape `create_element` result from an element object.
 */
function createElementResult(element: Record<string, unknown>): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Element created successfully!\n\n${JSON.stringify(element, null, 2)}\n\n✅ Synced to canvas`,
      },
    ],
  }
}

function updateElementResult(element: Record<string, unknown>): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Element updated successfully!\n\n${JSON.stringify(element, null, 2)}\n\n✅ Synced to canvas`,
      },
    ],
  }
}

function deleteElementResult(id: string): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Element deleted successfully!\n\n${JSON.stringify(
          { id, deleted: true, syncedToCanvas: true },
          null,
          2,
        )}\n\n✅ Synced to canvas`,
      },
    ],
  }
}

function batchCreateResult(elements: Record<string, unknown>[]): McpToolResult {
  const payload = {
    success: true,
    elements,
    count: elements.length,
    syncedToCanvas: true,
  }
  return {
    content: [
      {
        type: 'text',
        text: `${elements.length} elements created successfully!\n\n${JSON.stringify(payload, null, 2)}\n\n✅ All elements synced to canvas`,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Error / shape guards
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — error / shape guards', () => {
  it('returns [noop] for an error result', () => {
    const t = makeTranslator()
    const result: McpToolResult = { error: 'transport blew up' }
    const out = translateMcpToolResult(result, t)
    expect(out).toEqual([{ kind: 'noop', reason: expect.any(String) }])
  })

  it('returns [noop] for an empty content array', () => {
    const t = makeTranslator()
    const result: McpToolResult = { content: [] }
    const out = translateMcpToolResult(result, t)
    expect(out[0].kind).toBe('noop')
  })

  it('returns [noop] when content text is unparseable JSON', () => {
    const t = makeTranslator()
    const result: McpToolResult = {
      content: [{ type: 'text', text: 'Element created successfully!\n\nnot-json' }],
    }
    const out = translateMcpToolResult(result, t)
    expect(out[0].kind).toBe('noop')
  })

  it('returns [noop] when prose preamble is unrecognized AND no toolName', () => {
    const t = makeTranslator()
    const result: McpToolResult = {
      content: [{ type: 'text', text: 'Some random output without preamble' }],
    }
    const out = translateMcpToolResult(result, t)
    expect(out[0].kind).toBe('noop')
  })
})

// ---------------------------------------------------------------------------
// create_element → add
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — create_element', () => {
  it('produces an `add` mutation with the element id translated to canvas-id', () => {
    const t = makeTranslator()
    const result = createElementResult({
      id: 'mcp-abc',
      type: 'rectangle',
      x: 10,
      y: 20,
    })
    const out = translateMcpToolResult(result, t)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('add')
    if (out[0].kind === 'add') {
      expect(out[0].elements).toHaveLength(1)
      expect(out[0].elements[0].id).toBe('canvas-1')
      expect(out[0].elements[0].type).toBe('rectangle')
    }
  })

  it('via explicit toolName=create_element bypasses prose sniffing', () => {
    const t = makeTranslator()
    // Caller-supplied raw JSON without the prose preamble.
    const element = { id: 'mcp-abc', type: 'rectangle' }
    const result: McpToolResult = {
      content: [{ type: 'text', text: JSON.stringify(element) }],
    }
    const out = translateMcpToolResult(result, t, { toolName: 'create_element' })
    expect(out[0].kind).toBe('add')
    if (out[0].kind === 'add') {
      expect(out[0].elements[0].id).toBe('canvas-1')
    }
  })

  it('idempotent translation: reusing the same mcp id yields the same canvas id', () => {
    const t = makeTranslator()
    const r1 = createElementResult({ id: 'mcp-x', type: 'rectangle' })
    const r2 = createElementResult({ id: 'mcp-x', type: 'rectangle' })
    const out1 = translateMcpToolResult(r1, t)
    const out2 = translateMcpToolResult(r2, t)
    if (out1[0].kind !== 'add' || out2[0].kind !== 'add') throw new Error('expected add')
    expect(out1[0].elements[0].id).toBe(out2[0].elements[0].id)
  })
})

// ---------------------------------------------------------------------------
// update_element → update
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — update_element', () => {
  it('produces an `update` mutation with translated id and full element as patch', () => {
    const t = makeTranslator()
    // Pre-allocate the mapping so the update lands on the existing canvas id.
    const canvasId = t.translateMcpToCanvas('mcp-abc')
    const result = updateElementResult({
      id: 'mcp-abc',
      type: 'rectangle',
      x: 50,
    })
    const out = translateMcpToolResult(result, t)
    expect(out[0].kind).toBe('update')
    if (out[0].kind === 'update') {
      expect(out[0].ids).toEqual([canvasId])
      // The patch should NOT contain the (mcp) id field — the store keys
      // already; emitting an id in the patch would be confusing.
      expect(out[0].patch.id).toBe(canvasId)
      expect(out[0].patch.x).toBe(50)
    }
  })

  it('updates allocate a fresh canvas id on first contact (orchestrator may not have seen the create)', () => {
    const t = makeTranslator()
    const result = updateElementResult({ id: 'mcp-new', type: 'rectangle' })
    const out = translateMcpToolResult(result, t)
    if (out[0].kind !== 'update') throw new Error('expected update')
    expect(out[0].ids[0]).toBe('canvas-1')
  })
})

// ---------------------------------------------------------------------------
// delete_element → delete
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — delete_element', () => {
  it('produces a `delete` mutation with the translated id', () => {
    const t = makeTranslator()
    const canvasId = t.translateMcpToCanvas('mcp-del')
    const result = deleteElementResult('mcp-del')
    const out = translateMcpToolResult(result, t)
    expect(out[0].kind).toBe('delete')
    if (out[0].kind === 'delete') {
      expect(out[0].ids).toEqual([canvasId])
    }
  })
})

// ---------------------------------------------------------------------------
// batch_create_elements → add
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — batch_create_elements', () => {
  it('produces a single `add` mutation with all elements translated', () => {
    const t = makeTranslator()
    const result = batchCreateResult([
      { id: 'mcp-a', type: 'rectangle' },
      { id: 'mcp-b', type: 'ellipse' },
    ])
    const out = translateMcpToolResult(result, t)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('add')
    if (out[0].kind === 'add') {
      expect(out[0].elements).toHaveLength(2)
      expect(out[0].elements[0].id).toBe('canvas-1')
      expect(out[0].elements[1].id).toBe('canvas-2')
      // Original mcp ids must NOT leak through.
      for (const el of out[0].elements) {
        expect(typeof el.id).toBe('string')
        expect((el.id as string).startsWith(MCP_ID_PREFIX)).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Telemetry — unrecognized tool emits counter
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — telemetry', () => {
  it('increments excalidraw.unrecognized_tool_result on unknown tool name', () => {
    const t = makeTranslator()
    const increment = vi.fn()
    const result: McpToolResult = {
      content: [{ type: 'text', text: '{}' }],
    }
    translateMcpToolResult(result, t, {
      toolName: 'no_such_tool',
      telemetry: { increment },
    })
    expect(increment).toHaveBeenCalledWith('excalidraw.unrecognized_tool_result')
  })

  it('does NOT increment unrecognized counter on a recognized prose preamble', () => {
    const t = makeTranslator()
    const increment = vi.fn()
    const result = createElementResult({ id: 'mcp-x', type: 'rectangle' })
    translateMcpToolResult(result, t, { telemetry: { increment } })
    expect(increment).not.toHaveBeenCalledWith('excalidraw.unrecognized_tool_result')
  })
})

// ---------------------------------------------------------------------------
// Return-shape contract
// ---------------------------------------------------------------------------

describe('translateMcpToolResult — return shape', () => {
  it('always returns a non-empty array (callers can map without length checks)', () => {
    const t = makeTranslator()
    const cases: McpToolResult[] = [
      { error: 'x' },
      { content: [] },
      createElementResult({ id: 'a', type: 'rectangle' }),
    ]
    for (const c of cases) {
      const out: CanvasMutation[] = translateMcpToolResult(c, t)
      expect(Array.isArray(out)).toBe(true)
      expect(out.length).toBeGreaterThan(0)
    }
  })
})
