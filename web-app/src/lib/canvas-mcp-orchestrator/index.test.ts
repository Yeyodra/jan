import { describe, it, expect, vi } from 'vitest'
import type { MCPTool } from '@janhq/core'
import {
  CanvasMcpOrchestrator,
  NoopTelemetry,
  type CanvasMcpOrchestratorDeps,
  type BatchToken,
} from './index'
import {
  OrchestratorResponsibility,
  type OrchestratorResponsibilityName,
  type McpToolCall,
  type McpToolResult,
} from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: Partial<CanvasMcpOrchestratorDeps> = {},
): CanvasMcpOrchestratorDeps {
  return {
    canvasStore: {} as unknown,
    mcpClient: {} as unknown,
    ...overrides,
  }
}

function makeOrchestrator(
  overrides: Partial<CanvasMcpOrchestratorDeps> = {},
): CanvasMcpOrchestrator {
  return new CanvasMcpOrchestrator(makeDeps(overrides))
}

function fakeTool(name: string): MCPTool {
  return {
    name,
    description: `fake description for ${name}`,
    inputSchema: { type: 'object', properties: {} },
  } as unknown as MCPTool
}

// Expected method ↔ implementing-task pairs. Drives the parametric TODO
// assertions below.
//
// T14/T15/T16/T17/T22 partial-completion note: `resolveActiveCanvas`,
// `syncStateFromCanvas`, `dispatchToolCall`, `translateElementId`,
// `translateToolResult`, `beginAiBatch`, `endAiBatch`, and
// `lockManualEdits` have REAL implementations and have moved into their
// dedicated "real behaviour" describe blocks below. The remaining T14
// method (`applyTheme`) is the only public method that still throws TODO.
// `handleProcessCrash` is also T14-scoped but is intentionally left as a
// TODO thrower until the crash-restart wiring lands (separate sub-task —
// see plan §1480 follow-ups).
const RESPONSIBILITY_TASK_MAP: ReadonlyArray<{
  name: Exclude<
    OrchestratorResponsibilityName,
    | 'enforceCuratedToolList'
    | 'resolveActiveCanvas'
    | 'syncStateFromCanvas'
    | 'dispatchToolCall'
    | 'translateElementId'
    | 'translateToolResult'
    | 'beginAiBatch'
    | 'endAiBatch'
    | 'lockManualEdits'
  >
  task: string
}> = [
  { name: 'handleProcessCrash', task: 'T14' },
  { name: 'applyTheme', task: 'T14' },
]

// ---------------------------------------------------------------------------
// Construction + self-check
// ---------------------------------------------------------------------------

describe('CanvasMcpOrchestrator — construction', () => {
  it('constructs with a minimal deps bag', () => {
    expect(() => makeOrchestrator()).not.toThrow()
  })

  it('defaults telemetry to NoopTelemetry when omitted', () => {
    const o = makeOrchestrator()
    // protected field — read via cast for the assertion
    const sink = (o as unknown as { telemetry: unknown }).telemetry
    expect(sink).toBe(NoopTelemetry)
  })

  it('exposes ALL 11 responsibilities as functions on the instance', () => {
    const o = makeOrchestrator()
    const required = Object.keys(
      OrchestratorResponsibility,
    ) as OrchestratorResponsibilityName[]
    expect(required).toHaveLength(11)
    for (const name of required) {
      expect(
        typeof (o as unknown as Record<string, unknown>)[name],
      ).toBe('function')
    }
  })

  it('reflection: prototype owns exactly the 11 responsibility methods', () => {
    const o = makeOrchestrator()
    const proto = Object.getPrototypeOf(o) as object
    const protoMethods = Object.getOwnPropertyNames(proto).filter(
      (n) =>
        n !== 'constructor' &&
        typeof (proto as Record<string, unknown>)[n] === 'function',
    )
    const required = Object.keys(OrchestratorResponsibility)
    // Every required method must appear on the prototype.
    for (const name of required) {
      expect(protoMethods).toContain(name)
    }
    // And the prototype must NOT carry surprise extras beyond the 11.
    expect(protoMethods.sort()).toEqual([...required].sort())
  })

  it('self-check throws when a required method is missing', () => {
    // Subclass that deletes `applyTheme` from its prototype BEFORE the
    // self-check runs. The base-class constructor's self-check must catch it.
    class Broken extends CanvasMcpOrchestrator {}
    // Remove the inherited method on the subclass prototype.
    delete (Broken.prototype as unknown as Record<string, unknown>).applyTheme
    Object.defineProperty(Broken.prototype, 'applyTheme', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(() => new Broken(makeDeps())).toThrowError(
      /missing required methods.*applyTheme/,
    )
  })
})

// ---------------------------------------------------------------------------
// TODO-thrower coverage (10 methods)
// ---------------------------------------------------------------------------

describe('CanvasMcpOrchestrator — TODO throwers', () => {
  for (const { name, task } of RESPONSIBILITY_TASK_MAP) {
    it(`${name}() throws a TODO error referencing ${task}`, async () => {
      const o = makeOrchestrator()
      const method = (o as unknown as Record<string, (...a: unknown[]) => unknown>)[
        name
      ]
      expect(typeof method).toBe('function')

      // Build a regex like /resolveActiveCanvas.*T14/ — both substrings must
      // appear in the message. Stricter than substring-contains.
      const expected = new RegExp(`${name}.*${task}`)

      // Some methods are async (return Promise), some sync. Handle both.
      const invoke = () => {
        switch (name) {
          case 'applyTheme':
            return method.call(o, [])
          default:
            return method.call(o)
        }
      }

      if (name === 'handleProcessCrash') {
        // Strictly async — must reject.
        await expect(invoke()).rejects.toThrowError(expected)
      } else {
        expect(invoke).toThrowError(expected)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// enforceCuratedToolList — REAL behaviour
// ---------------------------------------------------------------------------

describe('CanvasMcpOrchestrator — enforceCuratedToolList', () => {
  it('filters out blocked tools (export_to_image) and keeps allowed ones', () => {
    const o = makeOrchestrator()
    const input: MCPTool[] = [
      fakeTool('create_element'),
      fakeTool('export_to_image'),
    ]
    const out = o.enforceCuratedToolList(input)
    expect(out).toHaveLength(1)
    expect(out.map((t) => t.name)).toEqual(['create_element'])
    expect(out.map((t) => t.name)).not.toContain('export_to_image')
  })

  it('returns an empty array when given an empty array', () => {
    const o = makeOrchestrator()
    expect(o.enforceCuratedToolList([])).toEqual([])
  })

  it('drops unknown tools (closed allow-list)', () => {
    const o = makeOrchestrator()
    const out = o.enforceCuratedToolList([fakeTool('totally_unknown_tool')])
    expect(out).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// T14 wired methods — REAL behaviour (resolveActiveCanvas + syncStateFromCanvas)
// ---------------------------------------------------------------------------
//
// These two methods used to throw TODO errors; T14 wired them to the pure
// helpers in `./active-canvas`. The exhaustive behaviour matrix lives in
// `./active-canvas.test.ts`. The integration assertions below only confirm
// the orchestrator class WIRES THROUGH correctly: passes the router from
// `deps`, threads the per-instance session token, and forwards results.

describe('CanvasMcpOrchestrator — resolveActiveCanvas (wired in T14)', () => {
  it('returns null when no router is injected', () => {
    const o = makeOrchestrator()
    expect(o.resolveActiveCanvas()).toBeNull()
  })

  it('returns the canvasId when the injected router is on the canvas route', () => {
    const o = makeOrchestrator({
      router: {
        state: {
          matches: [
            { routeId: '__root__', params: {} },
            { routeId: '/canvas/$canvasId', params: { canvasId: 'cv-xyz' } },
          ],
        },
      },
    })
    expect(o.resolveActiveCanvas()).toBe('cv-xyz')
  })

  it('returns null when the injected router is on a non-canvas route', () => {
    const o = makeOrchestrator({
      router: {
        state: {
          matches: [
            { routeId: '__root__', params: {} },
            { routeId: '/threads/$threadId', params: { threadId: 't-1' } },
          ],
        },
      },
    })
    expect(o.resolveActiveCanvas()).toBeNull()
  })
})

describe('CanvasMcpOrchestrator — syncStateFromCanvas (wired in T14)', () => {
  it('returns the SyncOutcome from the underlying helper', async () => {
    // No router injected, so canvas resolves to null → skip outcome.
    const o = makeOrchestrator()
    const outcome = await o.syncStateFromCanvas()
    expect(outcome).toEqual({ status: 'skipped', reason: 'no-active-canvas' })
  })

  it('forwards the active canvas through to import_scene once', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const o = makeOrchestrator({
      router: {
        state: {
          matches: [
            { routeId: '/canvas/$canvasId', params: { canvasId: 'cv-1' } },
          ],
        },
      },
      canvasStore: {
        getCanvas: (id: string) =>
          id === 'cv-1'
            ? {
                id: 'cv-1',
                name: 'cv',
                createdAt: '2026-06-17T00:00:00.000Z',
                updatedAt: '2026-06-17T00:00:00.000Z',
                elements: [{ id: 'el-1', type: 'rectangle' }],
                appState: {},
                files: {},
              }
            : undefined,
      },
      mcpClient: { callTool },
    })

    const first = await o.syncStateFromCanvas()
    const second = await o.syncStateFromCanvas()

    expect(callTool).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ status: 'imported', elementCount: 1 })
    expect(second).toEqual({ status: 'skipped', reason: 'already-synced' })
  })
})

// ---------------------------------------------------------------------------
// T15 wired method — REAL behaviour (dispatchToolCall)
// ---------------------------------------------------------------------------
//
// Exhaustive gate behaviour lives in `./dispatch.test.ts`. The integration
// assertions here only confirm that the orchestrator class WIRES THROUGH
// correctly: passes the mcpClient, approvalGate, and threadId from `deps`,
// and that `setThreadId` mutates the value used by subsequent calls.

describe('CanvasMcpOrchestrator — dispatchToolCall (wired in T15)', () => {
  it('rejects a blocked tool without touching mcpClient', async () => {
    const callTool = vi.fn()
    const approvalGate = vi.fn(async () => true)
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate,
      threadId: 'thr-1',
    })

    const result = await o.dispatchToolCall({
      name: 'export_to_image',
      arguments: {},
    })

    expect(result).toEqual({ error: 'tool not available in this build' })
    expect(callTool).not.toHaveBeenCalled()
    expect(approvalGate).not.toHaveBeenCalled()
  })

  it('forwards a mutating tool to mcpClient when the gate approves', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'created' }] })
    const approvalGate = vi.fn(async () => true)
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate,
      threadId: 'thr-2',
    })

    const call: McpToolCall = {
      name: 'create_element',
      arguments: { type: 'rectangle' },
    }
    const result = await o.dispatchToolCall(call)

    expect(approvalGate).toHaveBeenCalledTimes(1)
    expect(approvalGate).toHaveBeenCalledWith(
      'create_element',
      'thr-2',
      call.arguments,
    )
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith(call)
    expect(result).toEqual({ content: [{ type: 'text', text: 'created' }] })
  })

  it('returns user-denied envelope when approval gate resolves false', async () => {
    const callTool = vi.fn()
    const approvalGate = vi.fn(async () => false)
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate,
      threadId: 'thr-3',
    })

    const result = await o.dispatchToolCall({
      name: 'clear_canvas',
      arguments: {},
    })

    expect(result).toEqual({ error: 'user denied tool call' })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('fails closed when approvalGate is undefined for a mutating tool', async () => {
    const callTool = vi.fn()
    const o = makeOrchestrator({
      mcpClient: { callTool },
      // approvalGate intentionally omitted
      threadId: 'thr-4',
    })

    const result = await o.dispatchToolCall({
      name: 'create_element',
      arguments: {},
    })

    expect(result).toEqual({
      error: 'tool requires approval but no gate configured',
    })
    expect(callTool).not.toHaveBeenCalled()
  })

  it('bypasses approval for readonly tools', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: '[]' }] })
    const approvalGate = vi.fn(async () => false)
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate,
      threadId: 'thr-5',
    })

    const result = await o.dispatchToolCall({
      name: 'query_elements',
      arguments: {},
    })

    expect(approvalGate).not.toHaveBeenCalled()
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ content: [{ type: 'text', text: '[]' }] })
  })

  it('honors setThreadId() updates for subsequent dispatches', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
    const approvalGate = vi.fn(async () => true)
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate,
      threadId: 'thr-initial',
    })

    o.setThreadId('thr-updated')
    await o.dispatchToolCall({ name: 'create_element', arguments: {} })

    expect(approvalGate).toHaveBeenCalledWith(
      'create_element',
      'thr-updated',
      {},
    )
  })

  it('catches transport throws and returns { error }', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('socket closed'))
    const o = makeOrchestrator({
      mcpClient: { callTool },
      approvalGate: async () => true,
      threadId: 'thr-6',
    })

    const result = await o.dispatchToolCall({
      name: 'create_element',
      arguments: {},
    })

    expect(result).toEqual({ error: 'socket closed' })
  })
})

// ---------------------------------------------------------------------------
// translateElementId / translateToolResult — REAL behaviour (wired in T16)
// ---------------------------------------------------------------------------
//
// Exhaustive coverage of the bi-map and the wire-shape parser lives in
// `./id-translation.test.ts` and `./result-translator.test.ts`. The
// integration assertions here only confirm the orchestrator class WIRES
// THROUGH correctly: the per-instance `IdTranslator` is created at
// construction time with the (optionally injected) `generateId`, and the
// two responsibility methods delegate to it.

describe('CanvasMcpOrchestrator — translateElementId (wired in T16)', () => {
  it('allocates a canvas id on first contact and is idempotent on repeat', () => {
    let n = 0
    const o = makeOrchestrator({ generateId: () => `c-${++n}` })
    const a1 = o.translateElementId('mcp-a')
    const a2 = o.translateElementId('mcp-a')
    const b = o.translateElementId('mcp-b')
    expect(a1).toBe('c-1')
    expect(a2).toBe('c-1')
    expect(b).toBe('c-2')
  })

  it('reverseTranslateElementId returns the original mcp id', () => {
    let n = 0
    const o = makeOrchestrator({ generateId: () => `c-${++n}` })
    const canvasId = o.translateElementId('mcp-x')
    expect(o.reverseTranslateElementId(canvasId)).toBe('mcp-x')
    expect(o.reverseTranslateElementId('not-mapped')).toBeUndefined()
  })

  it('registerUserElement makes a user-created id reverse-translatable as identity', () => {
    const o = makeOrchestrator()
    o.registerUserElement('user-z')
    expect(o.reverseTranslateElementId('user-z')).toBe('user-z')
  })

  it('uses crypto.randomUUID-style default when generateId is omitted', () => {
    const o = makeOrchestrator() // no generateId
    const canvasId = o.translateElementId('mcp-x')
    // UUID v4-shaped — 36 chars with 4 hyphens.
    expect(canvasId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('CanvasMcpOrchestrator — translateToolResult (wired in T16)', () => {
  it('returns [noop] for an error envelope', () => {
    const o = makeOrchestrator()
    const out = o.translateToolResult({ error: 'boom' })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('noop')
  })

  it('produces an `add` mutation for a create_element wire result with translated id', () => {
    let n = 0
    const o = makeOrchestrator({ generateId: () => `c-${++n}` })
    const element = { id: 'mcp-1', type: 'rectangle', x: 1 }
    const text = `Element created successfully!\n\n${JSON.stringify(element, null, 2)}\n\n✅ Synced to canvas`
    const out = o.translateToolResult({ content: [{ type: 'text', text }] })
    expect(out).toHaveLength(1)
    if (out[0].kind !== 'add') throw new Error('expected add')
    expect(out[0].elements[0].id).toBe('c-1')
  })

  it('translateToolResultByName bypasses prose sniffing', () => {
    let n = 0
    const o = makeOrchestrator({ generateId: () => `c-${++n}` })
    const element = { id: 'mcp-y', type: 'rectangle' }
    const out = o.translateToolResultByName('create_element', {
      content: [{ type: 'text', text: JSON.stringify(element) }],
    })
    if (out[0].kind !== 'add') throw new Error('expected add')
    expect(out[0].elements[0].id).toBe('c-1')
  })

  it('shares the same IdTranslator across translateElementId and translateToolResult', () => {
    let n = 0
    const o = makeOrchestrator({ generateId: () => `c-${++n}` })
    const canvasId = o.translateElementId('mcp-shared') // → c-1
    const text = `Element updated successfully!\n\n${JSON.stringify({ id: 'mcp-shared', x: 99 }, null, 2)}\n\n✅`
    const out = o.translateToolResult({ content: [{ type: 'text', text }] })
    if (out[0].kind !== 'update') throw new Error('expected update')
    // Must reuse the existing mapping rather than allocating a new id.
    expect(out[0].ids).toEqual([canvasId])
  })
})

// ---------------------------------------------------------------------------
// beginAiBatch / endAiBatch — REAL behaviour (wired in T17)
// ---------------------------------------------------------------------------
//
// Exhaustive coverage of the begin/apply/end lifecycle + zombie recovery
// lives in `./batch.test.ts`. The integration assertions here only confirm
// the orchestrator class WIRES THROUGH correctly: the `excalidrawAPI` from
// `deps` is forwarded to the batch controller; the IMMEDIATELY commit fires
// at `endAiBatch` time; nested `beginAiBatch` returns the existing token.
// Also confirms the new instance-arrow methods (`applyDuringBatch`,
// `forceEndBatch`) are wired and do NOT pollute the prototype.

describe('CanvasMcpOrchestrator — beginAiBatch/endAiBatch (wired in T17)', () => {
  it('beginAiBatch returns a BatchToken; endAiBatch commits IMMEDIATELY exactly once', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    const token = o.beginAiBatch()
    expect(typeof token).toBe('symbol')

    o.applyDuringBatch([{ id: 'el-1', type: 'rectangle' }])
    o.endAiBatch(token)

    const captures = updateScene.mock.calls.map(
      (args) => (args[0] as { captureUpdate: string }).captureUpdate,
    )
    expect(captures.filter((v) => v === 'NEVER')).toHaveLength(1)
    expect(captures.filter((v) => v === 'IMMEDIATELY')).toHaveLength(1)
  })

  it('3 applyDuringBatch calls within batch → exactly 1 IMMEDIATELY after endAiBatch', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    const token = o.beginAiBatch()
    o.applyDuringBatch([{ id: 'a', type: 'rectangle' }])
    o.applyDuringBatch([
      { id: 'a', type: 'rectangle' },
      { id: 'b', type: 'ellipse' },
    ])
    o.applyDuringBatch([
      { id: 'a', type: 'rectangle' },
      { id: 'b', type: 'ellipse' },
      { id: 'c', type: 'arrow' },
    ])
    o.endAiBatch(token)

    const captures = updateScene.mock.calls.map(
      (args) => (args[0] as { captureUpdate: string }).captureUpdate,
    )
    expect(captures.filter((v) => v === 'NEVER')).toHaveLength(3)
    expect(captures.filter((v) => v === 'IMMEDIATELY')).toHaveLength(1)
    // Final IMMEDIATELY carries 3 elements (the last good state).
    const last = updateScene.mock.calls.at(-1)![0] as {
      elements: Array<{ id: string }>
    }
    expect(last.elements.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('nested beginAiBatch returns the existing token (single-level batching)', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    const t1 = o.beginAiBatch()
    const t2 = o.beginAiBatch()
    expect(t2).toBe(t1)
    o.endAiBatch(t1)
    expect(updateScene.mock.calls).toHaveLength(1)
  })

  it('endAiBatch with mismatched token leaves batch open (recoverable)', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    const real = o.beginAiBatch()
    const wrong = Symbol('wrong') as unknown as BatchToken
    o.endAiBatch(wrong) // no-op
    expect(updateScene).not.toHaveBeenCalled()

    // Real token still works.
    o.endAiBatch(real)
    expect(updateScene).toHaveBeenCalledTimes(1)
    expect(
      (updateScene.mock.calls[0][0] as { captureUpdate: string }).captureUpdate,
    ).toBe('IMMEDIATELY')
  })

  it('forceEndBatch drains an in-flight batch (zombie recovery)', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    o.beginAiBatch()
    o.applyDuringBatch([{ id: 'z', type: 'rectangle' }])
    o.forceEndBatch()

    const captures = updateScene.mock.calls.map(
      (args) => (args[0] as { captureUpdate: string }).captureUpdate,
    )
    expect(captures.filter((v) => v === 'IMMEDIATELY')).toHaveLength(1)
    // After force-end, a fresh begin is allowed.
    const freshToken = o.beginAiBatch()
    expect(typeof freshToken).toBe('symbol')
  })

  it('fail-closed: beginAiBatch / endAiBatch are safe no-ops without excalidrawAPI', () => {
    const o = makeOrchestrator() // no excalidrawAPI
    const token = o.beginAiBatch()
    expect(typeof token).toBe('symbol')
    expect(() => o.applyDuringBatch([{ id: 'a', type: 'rectangle' }])).not.toThrow()
    expect(() => o.endAiBatch(token)).not.toThrow()
  })

  it('applyDuringBatch and forceEndBatch are instance arrows (NOT on prototype)', () => {
    const o = makeOrchestrator()
    const proto = Object.getPrototypeOf(o) as object
    const protoNames = Object.getOwnPropertyNames(proto)
    // Must NOT pollute prototype — keeps the 11-method reflection invariant.
    expect(protoNames).not.toContain('applyDuringBatch')
    expect(protoNames).not.toContain('forceEndBatch')
    // But MUST exist on the instance.
    expect(typeof o.applyDuringBatch).toBe('function')
    expect(typeof o.forceEndBatch).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// lockManualEdits — REAL behaviour (wired in T22)
// ---------------------------------------------------------------------------
//
// The exhaustive behaviour matrix lives in `./lock.test.ts`. The integration
// assertions here only confirm the orchestrator class WIRES THROUGH
// correctly: `lockManualEdits()` delegates to the lock controller, the new
// instance-arrow methods (`isManualEditLocked`, `subscribeManualEditLock`)
// are present and do NOT pollute the prototype, and `endAiBatch` ALWAYS
// drains the lock as part of its commit (auto-unlock per plan §2186-2187).

describe('CanvasMcpOrchestrator — lockManualEdits (wired in T22)', () => {
  it('lockManualEdits returns an unlock fn; calling it restores edit mode', () => {
    const o = makeOrchestrator()
    expect(o.isManualEditLocked()).toBe(false)

    const unlock = o.lockManualEdits()
    expect(typeof unlock).toBe('function')
    expect(o.isManualEditLocked()).toBe(true)

    unlock()
    expect(o.isManualEditLocked()).toBe(false)
  })

  it('refcount stacking: 3 locks → first 2 unlocks keep locked; 3rd restores', () => {
    const o = makeOrchestrator()
    const u1 = o.lockManualEdits()
    const u2 = o.lockManualEdits()
    const u3 = o.lockManualEdits()
    expect(o.isManualEditLocked()).toBe(true)

    u1()
    expect(o.isManualEditLocked()).toBe(true)
    u2()
    expect(o.isManualEditLocked()).toBe(true)
    u3()
    expect(o.isManualEditLocked()).toBe(false)
  })

  it('idempotent unlock: calling the same unlockFn twice does NOT double-decrement', () => {
    const o = makeOrchestrator()
    const u1 = o.lockManualEdits()
    const u2 = o.lockManualEdits()

    u1()
    u1() // no-op
    expect(o.isManualEditLocked()).toBe(true)

    u2()
    expect(o.isManualEditLocked()).toBe(false)
  })

  it('subscribeManualEditLock fires on every refcount change and returns unsubscribe', () => {
    const o = makeOrchestrator()
    const observer = vi.fn()
    const unsubscribe = o.subscribeManualEditLock(observer)

    const u1 = o.lockManualEdits() // event 1
    const u2 = o.lockManualEdits() // event 2
    u1() // event 3
    u2() // event 4

    expect(observer).toHaveBeenCalledTimes(4)
    expect(observer.mock.calls[0]).toEqual([true, 1])
    expect(observer.mock.calls[3]).toEqual([false, 0])

    unsubscribe()
    o.lockManualEdits()
    expect(observer).toHaveBeenCalledTimes(4) // not called again
  })

  it('endAiBatch auto-unlocks the manual-edit lock (plan §2186-2187)', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    o.lockManualEdits()
    o.lockManualEdits()
    expect(o.isManualEditLocked()).toBe(true)

    const token = o.beginAiBatch()
    o.endAiBatch(token)

    // forceUnlock under the hood — refcount drained even though we never
    // called the original unlockFns.
    expect(o.isManualEditLocked()).toBe(false)
  })

  it('endAiBatch on an idle lock is still safe (no-op forceUnlock)', () => {
    const updateScene = vi.fn()
    const o = makeOrchestrator({ excalidrawAPI: { updateScene } })

    const token = o.beginAiBatch()
    expect(() => o.endAiBatch(token)).not.toThrow()
    expect(o.isManualEditLocked()).toBe(false)
  })

  it('isManualEditLocked and subscribeManualEditLock are instance arrows (NOT on prototype)', () => {
    const o = makeOrchestrator()
    const proto = Object.getPrototypeOf(o) as object
    const protoNames = Object.getOwnPropertyNames(proto)
    // Must NOT pollute prototype — keeps the 11-method reflection invariant.
    expect(protoNames).not.toContain('isManualEditLocked')
    expect(protoNames).not.toContain('subscribeManualEditLock')
    // But MUST exist on the instance.
    expect(typeof o.isManualEditLocked).toBe('function')
    expect(typeof o.subscribeManualEditLock).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Decoupling assertion (plan §1467–1468)
// ---------------------------------------------------------------------------

describe('CanvasMcpOrchestrator — decoupling', () => {
  it('does not reach into deps.canvasStore or deps.mcpClient at construction', () => {
    // Use a Proxy that throws on ANY property access; if the constructor
    // touches the store or the client we will see an immediate throw.
    const tripwire = new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(
            `tripwire: orchestrator must not access deps at construction (prop=${String(prop)})`,
          )
        },
      },
    )
    expect(() =>
      new CanvasMcpOrchestrator({
        canvasStore: tripwire,
        mcpClient: tripwire,
        themeProvider: tripwire,
      }),
    ).not.toThrow()
  })

  it('does not import React, zustand, or Excalidraw at module load', () => {
    // Static import-time check — if `./index` had pulled any of these in,
    // they would already be in `require.cache`/the module graph by the time
    // this test runs. We assert by inspecting the source file directly.
    // (Vitest runs in node; `require.resolve` is available.)
    // Use a string-search on the compiled source: the imports line is the
    // simplest contractual signal.
    // NOTE: this is a structural smoke test — `types.ts` and
    // `curated-tools.ts` ARE allowed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, 'index.ts'),
      'utf8',
    )
    // Only forbid these as IMPORT specifiers, not as words in JSDoc/text.
    const forbidden = [
      "from 'react'",
      'from "react"',
      "from 'zustand'",
      'from "zustand"',
      "from '@excalidraw/excalidraw'",
      'from "@excalidraw/excalidraw"',
      "from '@tanstack/react-router'",
      'from "@tanstack/react-router"',
    ]
    for (const needle of forbidden) {
      expect(src).not.toContain(needle)
    }
  })
})
