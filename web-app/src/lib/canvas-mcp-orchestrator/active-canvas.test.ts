/**
 * Tests for active-canvas resolution + sync (T14).
 *
 * Style follows `web-app/src/lib/canvas/dispatch.test.ts`:
 *   - Pure dependency-injected helpers; no React, no zustand, no router.
 *   - Mocks are inlined; no Excalidraw runtime touched.
 *
 * What this suite covers (verbatim from plan T14 acceptance):
 *
 *   resolveActiveCanvas
 *     1. matching route → returns id
 *     2. non-canvas route → null
 *     3. no router / empty matches → null
 *     (+ extra: nested layout that includes the parent canvas route)
 *
 *   syncStateFromCanvas
 *     1. happy path: calls import_scene exactly once with serialized
 *        elements + mode=replace
 *     2. empty canvas → import_scene NOT called (decision documented in
 *        active-canvas.ts header — mcp rejects empty arrays)
 *     3. import failure (callTool throws) → caught + logged, no rethrow
 *     4. import failure (callTool returns error envelope) → reported as
 *        `failed` outcome, no rethrow
 *     5. idempotency: double-call within same session token → callTool
 *        invoked once
 *     6. distinct session tokens → callTool invoked once per token
 *     7. missing canvas / null canvasId → no-op + no callTool
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  CANVAS_DETAIL_ROUTE_ID,
  resolveActiveCanvas,
  syncStateFromCanvas,
  __resetSyncedSessionsForTests,
  type CanvasStoreLike,
  type McpClientLike,
  type RouterLike,
  type SyncLogger,
} from './active-canvas'
import type { Canvas } from '@/types/canvas'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeRouter = (
  matches: ReadonlyArray<{ routeId: string; params?: Record<string, string> }>,
): RouterLike => ({
  state: {
    matches: matches.map((m) => ({
      routeId: m.routeId,
      params: m.params ?? {},
    })),
  },
})

const makeCanvas = (
  id: string,
  elementCount: number,
  overrides: Partial<Canvas> = {},
): Canvas => ({
  id,
  name: `canvas-${id}`,
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
  elements: Array.from({ length: elementCount }, (_, i) => ({
    id: `el-${i}`,
    type: 'rectangle',
  })) as unknown as Canvas['elements'],
  appState: {},
  files: {},
  ...overrides,
})

const makeStore = (canvases: Record<string, Canvas>): CanvasStoreLike => ({
  getCanvas: (id) => canvases[id],
})

const makeMcpClient = (
  callTool: McpClientLike['callTool'] = vi
    .fn()
    .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
): McpClientLike => ({ callTool })

const makeLogger = (): SyncLogger & {
  debug: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} => ({
  debug: vi.fn(),
  warn: vi.fn(),
})

beforeEach(() => {
  __resetSyncedSessionsForTests()
})

// ---------------------------------------------------------------------------
// resolveActiveCanvas
// ---------------------------------------------------------------------------

describe('resolveActiveCanvas', () => {
  it('returns the canvasId when the active route matches /canvas/$canvasId', () => {
    const router = makeRouter([
      { routeId: '__root__' },
      { routeId: CANVAS_DETAIL_ROUTE_ID, params: { canvasId: 'abc-123' } },
    ])
    expect(resolveActiveCanvas(router)).toBe('abc-123')
  })

  it('returns null when the active route is not a canvas route', () => {
    const router = makeRouter([
      { routeId: '__root__' },
      { routeId: '/threads/$threadId', params: { threadId: 't-9' } },
    ])
    expect(resolveActiveCanvas(router)).toBeNull()
  })

  it('returns null when no router is provided', () => {
    expect(resolveActiveCanvas(null)).toBeNull()
    expect(resolveActiveCanvas(undefined)).toBeNull()
  })

  it('returns null when matches is empty', () => {
    expect(resolveActiveCanvas(makeRouter([]))).toBeNull()
  })

  it('still resolves canvasId from a parent match for nested layouts', () => {
    // Imagine /canvas/$canvasId/edit — the parent route still carries the
    // canvasId param, and our helper must find it.
    const router = makeRouter([
      { routeId: '__root__' },
      { routeId: CANVAS_DETAIL_ROUTE_ID, params: { canvasId: 'parent-id' } },
      { routeId: '/canvas/$canvasId/edit', params: { canvasId: 'parent-id' } },
    ])
    expect(resolveActiveCanvas(router)).toBe('parent-id')
  })

  it('returns null when canvasId param is missing or empty', () => {
    const router = makeRouter([
      { routeId: CANVAS_DETAIL_ROUTE_ID, params: {} },
    ])
    expect(resolveActiveCanvas(router)).toBeNull()

    const router2 = makeRouter([
      { routeId: CANVAS_DETAIL_ROUTE_ID, params: { canvasId: '' } },
    ])
    expect(resolveActiveCanvas(router2)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// syncStateFromCanvas
// ---------------------------------------------------------------------------

describe('syncStateFromCanvas', () => {
  it('calls import_scene exactly once with the serialized scene', async () => {
    const canvas = makeCanvas('cv-1', 2)
    const store = makeStore({ 'cv-1': canvas })
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const client = makeMcpClient(callTool)

    const outcome = await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: 'sess-happy',
    })

    expect(callTool).toHaveBeenCalledTimes(1)
    const call = callTool.mock.calls[0][0]
    expect(call.name).toBe('import_scene')
    expect(call.arguments.mode).toBe('replace')

    // The `data` field is a JSON string — parse and verify the elements
    // round-tripped intact.
    const parsed = JSON.parse(String(call.arguments.data))
    expect(parsed.elements).toHaveLength(2)
    expect(parsed.elements[0].id).toBe('el-0')
    expect(parsed.source).toBe('jan-canvas-mcp-orchestrator')

    expect(outcome).toEqual({ status: 'imported', elementCount: 2 })
  })

  it('is a no-op when the canvas has zero elements', async () => {
    const canvas = makeCanvas('cv-empty', 0)
    const store = makeStore({ 'cv-empty': canvas })
    const callTool = vi.fn()
    const client = makeMcpClient(callTool)
    const logger = makeLogger()

    const outcome = await syncStateFromCanvas({
      canvasId: 'cv-empty',
      store,
      mcpClient: client,
      sessionToken: 'sess-empty',
      logger,
    })

    expect(callTool).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'skipped', reason: 'empty-canvas' })
    // We log at debug level — the test asserts the message presence so
    // future log-rewrites don't silently swallow this signal.
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('empty canvas'),
      expect.objectContaining({ canvasId: 'cv-empty' }),
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('swallows + logs when callTool throws', async () => {
    const canvas = makeCanvas('cv-1', 1)
    const store = makeStore({ 'cv-1': canvas })
    const callTool = vi.fn().mockRejectedValue(new Error('mcp transport boom'))
    const client = makeMcpClient(callTool)
    const logger = makeLogger()

    const outcome = await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: 'sess-throw',
      logger,
    })

    expect(outcome).toEqual({ status: 'failed', error: 'mcp transport boom' })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('import_scene threw'),
      expect.objectContaining({ error: 'mcp transport boom' }),
    )
  })

  it('surfaces the error envelope when callTool returns one', async () => {
    const canvas = makeCanvas('cv-1', 1)
    const store = makeStore({ 'cv-1': canvas })
    const callTool = vi.fn().mockResolvedValue({ error: 'server said no' })
    const client = makeMcpClient(callTool)
    const logger = makeLogger()

    const outcome = await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: 'sess-err-env',
      logger,
    })

    expect(outcome).toEqual({ status: 'failed', error: 'server said no' })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('is idempotent within the same session token', async () => {
    const canvas = makeCanvas('cv-1', 1)
    const store = makeStore({ 'cv-1': canvas })
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const client = makeMcpClient(callTool)

    const token = 'sess-idem'

    const first = await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: token,
    })
    const second = await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: token,
    })

    expect(callTool).toHaveBeenCalledTimes(1)
    expect(first.status).toBe('imported')
    expect(second).toEqual({ status: 'skipped', reason: 'already-synced' })
  })

  it('syncs separately for distinct session tokens', async () => {
    const canvas = makeCanvas('cv-1', 1)
    const store = makeStore({ 'cv-1': canvas })
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const client = makeMcpClient(callTool)

    await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: 'sess-A',
    })
    await syncStateFromCanvas({
      canvasId: 'cv-1',
      store,
      mcpClient: client,
      sessionToken: 'sess-B',
    })

    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it('skips with reason=no-active-canvas when canvasId is null', async () => {
    const store = makeStore({})
    const callTool = vi.fn()

    const outcome = await syncStateFromCanvas({
      canvasId: null,
      store,
      mcpClient: makeMcpClient(callTool),
      sessionToken: 'sess-null',
    })

    expect(callTool).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'skipped', reason: 'no-active-canvas' })
  })

  it('skips with reason=canvas-missing when the store has no such canvas', async () => {
    const store = makeStore({})
    const callTool = vi.fn()

    const outcome = await syncStateFromCanvas({
      canvasId: 'does-not-exist',
      store,
      mcpClient: makeMcpClient(callTool),
      sessionToken: 'sess-missing',
    })

    expect(callTool).not.toHaveBeenCalled()
    expect(outcome).toEqual({ status: 'skipped', reason: 'canvas-missing' })
  })

  it('idempotency holds even when first call was a skip', async () => {
    // A skip still counts as "this session is done"; subsequent calls must
    // not retry. This protects the prompt-bar (T18) from triggering an
    // expensive sync every time the user submits another message in a
    // thread that started on an empty canvas.
    const store = makeStore({ 'cv-empty': makeCanvas('cv-empty', 0) })
    const callTool = vi.fn()

    await syncStateFromCanvas({
      canvasId: 'cv-empty',
      store,
      mcpClient: makeMcpClient(callTool),
      sessionToken: 'sess-skip-then-skip',
    })
    const second = await syncStateFromCanvas({
      canvasId: 'cv-empty',
      store,
      mcpClient: makeMcpClient(callTool),
      sessionToken: 'sess-skip-then-skip',
    })

    expect(callTool).not.toHaveBeenCalled()
    expect(second).toEqual({ status: 'skipped', reason: 'already-synced' })
  })
})
