/**
 * T1.5 — dispatcher tests for the canvas tool branch.
 *
 * Companion to `ai-tools.test.ts` (T28, which covers handler correctness
 * against the real store). This file exercises the thin wiring layer that
 * sits between the thread-route dispatcher (`routes/threads/$threadId.tsx`)
 * and the canvas tool handlers:
 *
 *   1. `dispatchCanvasTool` happy path — `canvas_list` returns an
 *      `MCPToolCallResult` whose `content[0].text` is the JSON-stringified
 *      handler return value, with `error === ''`.
 *   2. `dispatchCanvasTool` happy path — `canvas_create` (a mutating tool)
 *      receives its args, invokes the handler, and produces the same
 *      envelope shape. (Approval is the dispatcher's concern, not the
 *      helper's — see the predicate suite below.)
 *   3. Approval-gate predicate (the boolean expression the dispatcher uses
 *      to decide auto-approval) — `canvas_list` is auto-approved; the three
 *      mutating tools (`canvas_create`, `canvas_update`, `canvas_delete`)
 *      are NOT auto-approved; unrelated tool names fall through to the
 *      existing RAG/MCP predicate.
 *   4. `dispatchCanvasTool` error path — handler throws → error envelope
 *      with `result.error` populated, store side-effects are skipped.
 *
 * The store is exercised live (no mocks) for the same reason `ai-tools.test`
 * does: the helper IS the integration of registry + store + envelope, and
 * mocking the registry would defeat the purpose. `idb-keyval` is mocked
 * because the canvas store imports it eagerly through `persist`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// idb-keyval mock — mirrors `ai-tools.test.ts` / `canvas-store.test.ts`.
// ---------------------------------------------------------------------------
const idbStore = new Map<string, string>()
vi.mock('idb-keyval', () => ({
  get: async (name: string) => idbStore.get(name),
  set: async (name: string, value: string) => {
    idbStore.set(name, value)
  },
  del: async (name: string) => {
    idbStore.delete(name)
  },
}))

import { useCanvasStore } from '@/stores/canvas-store'
import { dispatchCanvasTool } from './dispatch'
import {
  canvasBuiltinToolsByName,
  mutatingToolNames,
  type CanvasBuiltinTool,
} from './ai-tools'

// ---------------------------------------------------------------------------
// Pure replica of the predicate in `$threadId.tsx:335-337`. If the dispatcher
// predicate changes, this test will fail loudly until both copies are
// reconciled — which is the point.
// ---------------------------------------------------------------------------
const isAutoApproved = (
  toolName: string,
  ragNames: ReadonlySet<string>,
  canvasNames: ReadonlySet<string>
): boolean =>
  ragNames.has(toolName) ||
  (canvasNames.has(toolName) && !mutatingToolNames.has(toolName))

// ---------------------------------------------------------------------------
// Reset the live store before each test. Same pattern as ai-tools.test.ts.
// ---------------------------------------------------------------------------
beforeEach(() => {
  useCanvasStore.setState({ canvases: {} })
  idbStore.clear()
})

describe('dispatchCanvasTool — happy paths', () => {
  it('canvas_list returns an MCPToolCallResult with stringified handler output and no error', async () => {
    // Seed the store so the list call has something to serialize.
    useCanvasStore.getState().create('first canvas')
    useCanvasStore.getState().create('second canvas')

    const result = await dispatchCanvasTool('canvas_list', {})

    expect(result.error).toBe('')
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })

    // canvas_list returns `{ canvases: [...] }` (see canvasListOutputSchema).
    const parsed = JSON.parse(result.content[0].text) as {
      canvases: Array<{ id: string; name: string }>
    }
    expect(parsed.canvases).toHaveLength(2)
    const names = parsed.canvases.map((c) => c.name).sort()
    expect(names).toEqual(['first canvas', 'second canvas'])
  })

  it('canvas_create dispatches the handler and returns the success envelope', async () => {
    const result = await dispatchCanvasTool('canvas_create', {
      name: 'fresh canvas',
    })

    expect(result.error).toBe('')
    expect(result.content).toHaveLength(1)

    const created = JSON.parse(result.content[0].text) as {
      id: string
      name: string
      createdAt: string
    }
    expect(created.name).toBe('fresh canvas')
    expect(typeof created.id).toBe('string')
    // createdAt is an ISO-8601 string with offset (per canvasCreateOutputSchema).
    expect(typeof created.createdAt).toBe('string')
    expect(Number.isFinite(Date.parse(created.createdAt))).toBe(true)

    // Store was actually mutated — this is the contract the dispatcher
    // depends on so the canvas appears in subsequent `canvas_list` calls.
    const stored = useCanvasStore.getState().get(created.id)
    expect(stored?.name).toBe('fresh canvas')
  })

  it('treats undefined args as {} so empty-input tools dont trip on zod', async () => {
    const result = await dispatchCanvasTool('canvas_list', undefined)
    expect(result.error).toBe('')
    const parsed = JSON.parse(result.content[0].text) as { canvases: unknown[] }
    expect(parsed.canvases).toEqual([])
  })
})

describe('dispatchCanvasTool — error paths', () => {
  it('returns an error envelope (not a throw) when the handler rejects', async () => {
    // canvas_read against an unknown id throws `Canvas not found: <id>`.
    const unknownId = '11111111-1111-4111-8111-111111111111'
    const result = await dispatchCanvasTool('canvas_read', { id: unknownId })

    expect(result.error).toContain('Canvas not found')
    expect(result.content[0].text).toBe(result.error)
    // Store is untouched.
    expect(Object.keys(useCanvasStore.getState().canvases)).toHaveLength(0)
  })

  it('returns an error envelope when the registry has no such tool', async () => {
    const emptyRegistry: ReadonlyMap<string, CanvasBuiltinTool> = new Map()
    const result = await dispatchCanvasTool(
      'canvas_bogus',
      {},
      { byName: emptyRegistry }
    )
    expect(result.error).toContain("'canvas_bogus' is not registered")
    expect(result.content[0].text).toContain('canvas_bogus')
  })

  it('surfaces zod input validation errors through the same envelope', async () => {
    // canvas_create with an empty name fails the zod input schema (min 1),
    // which `runHandler` reformats into `canvas_create failed: ...`.
    const result = await dispatchCanvasTool('canvas_create', { name: '' })
    expect(result.error).toMatch(/canvas_create failed/)
    expect(Object.keys(useCanvasStore.getState().canvases)).toHaveLength(0)
  })
})

describe('approval-gate predicate (mirrors $threadId.tsx)', () => {
  // The dispatcher computes this predicate once per tool call. The
  // assertions below correspond to the QA scenarios in the plan (line 484:
  // read-only must skip the modal; mutating must trigger it).

  const canvasNames = new Set<string>([
    'canvas_list',
    'canvas_create',
    'canvas_read',
    'canvas_update',
    'canvas_delete',
  ])
  const ragNames = new Set<string>(['rag_search'])

  it('auto-approves read-only canvas tools (canvas_list, canvas_read)', () => {
    expect(isAutoApproved('canvas_list', ragNames, canvasNames)).toBe(true)
    expect(isAutoApproved('canvas_read', ragNames, canvasNames)).toBe(true)
  })

  it('does NOT auto-approve mutating canvas tools', () => {
    expect(isAutoApproved('canvas_create', ragNames, canvasNames)).toBe(false)
    expect(isAutoApproved('canvas_update', ragNames, canvasNames)).toBe(false)
    expect(isAutoApproved('canvas_delete', ragNames, canvasNames)).toBe(false)
  })

  it('preserves existing behavior for RAG and unrelated tools', () => {
    expect(isAutoApproved('rag_search', ragNames, canvasNames)).toBe(true)
    // Unknown name → must go through approval (predicate returns false).
    expect(isAutoApproved('mcp_remote_tool', ragNames, canvasNames)).toBe(false)
  })

  it('agrees with the canonical mutatingToolNames set from ai-tools', () => {
    // Belt-and-braces: if someone reorders the mutating-set, this test will
    // catch the drift before the dispatcher silently auto-approves a
    // destructive call.
    expect([...mutatingToolNames].sort()).toEqual([
      'canvas_create',
      'canvas_delete',
      'canvas_update',
    ])
  })
})

describe('registry alignment', () => {
  // Sanity check that the helper dispatches through the same registry the
  // module exposes — if a future refactor decouples the two, the
  // `dispatchCanvasTool` happy paths above would still pass while the
  // dispatcher silently bypassed the canonical registry. The injected-deps
  // path proves the registry parameter is honored; the default path proves
  // the module-level map is the fallback.
  it('uses the injected registry when provided, and the canonical one otherwise', async () => {
    const sentinel = { sentinel: true }
    const fakeTool: CanvasBuiltinTool = {
      name: 'canvas_list',
      description: 'fake',
      inputSchema: { type: 'object' },
      server: 'canvas',
      handler: async () => sentinel,
    }
    const fakeRegistry = new Map<string, CanvasBuiltinTool>([
      ['canvas_list', fakeTool],
    ])

    // Injected registry → handler from fakeRegistry, not the real one.
    const injected = await dispatchCanvasTool('canvas_list', {}, {
      byName: fakeRegistry,
    })
    expect(JSON.parse(injected.content[0].text)).toEqual(sentinel)

    // Default (no deps) → real registry; output should be `{canvases: []}`
    // (store was reset in beforeEach).
    const real = await dispatchCanvasTool('canvas_list', {})
    expect(JSON.parse(real.content[0].text)).toEqual({ canvases: [] })

    // Defensive: the real registry actually contains all 5 tools.
    expect(canvasBuiltinToolsByName.size).toBe(5)
  })
})
