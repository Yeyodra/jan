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
// T14/T15/T16 partial-completion note: `resolveActiveCanvas`,
// `syncStateFromCanvas`, `dispatchToolCall`, `translateElementId`, and
// `translateToolResult` have REAL implementations as of T14/T15/T16 and have
// moved into the dedicated "real behaviour" describe blocks below. The
// remaining T14 method (`applyTheme`) and the T17/T22 methods still throw
// TODO and stay in this list. `handleProcessCrash` is also T14-scoped but
// is intentionally left as a TODO thrower until the crash-restart wiring
// lands (separate sub-task — see plan §1480 follow-ups).
const RESPONSIBILITY_TASK_MAP: ReadonlyArray<{
  name: Exclude<
    OrchestratorResponsibilityName,
    | 'enforceCuratedToolList'
    | 'resolveActiveCanvas'
    | 'syncStateFromCanvas'
    | 'dispatchToolCall'
    | 'translateElementId'
    | 'translateToolResult'
  >
  task: string
}> = [
  { name: 'beginAiBatch', task: 'T17' },
  { name: 'endAiBatch', task: 'T17' },
  { name: 'handleProcessCrash', task: 'T14' },
  { name: 'applyTheme', task: 'T14' },
  { name: 'lockManualEdits', task: 'T22' },
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
          case 'endAiBatch':
            return method.call(o, undefined as unknown as BatchToken)
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
