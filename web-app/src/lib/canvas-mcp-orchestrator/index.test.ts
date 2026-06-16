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
// T14 partial-completion note: `resolveActiveCanvas` and
// `syncStateFromCanvas` have REAL implementations as of T14 and have moved
// into the dedicated "real behaviour" describe block below. The remaining
// T14 method (`applyTheme`) and the T15/T16/T17/T22 methods still throw
// TODO and stay in this list. `handleProcessCrash` is also T14-scoped but
// is intentionally left as a TODO thrower until the crash-restart wiring
// lands (separate sub-task — see plan §1480 follow-ups).
const RESPONSIBILITY_TASK_MAP: ReadonlyArray<{
  name: Exclude<
    OrchestratorResponsibilityName,
    | 'enforceCuratedToolList'
    | 'resolveActiveCanvas'
    | 'syncStateFromCanvas'
  >
  task: string
}> = [
  { name: 'dispatchToolCall', task: 'T15' },
  { name: 'translateElementId', task: 'T16' },
  { name: 'beginAiBatch', task: 'T17' },
  { name: 'endAiBatch', task: 'T17' },
  { name: 'handleProcessCrash', task: 'T14' },
  { name: 'translateToolResult', task: 'T16' },
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
          case 'dispatchToolCall':
            return method.call(o, {
              name: 'noop',
              arguments: {},
            } as McpToolCall)
          case 'translateElementId':
            return method.call(o, 'mcp-id')
          case 'endAiBatch':
            return method.call(o, undefined as unknown as BatchToken)
          case 'translateToolResult':
            return method.call(o, { content: [] } as McpToolResult)
          case 'applyTheme':
            return method.call(o, [])
          default:
            return method.call(o)
        }
      }

      if (name === 'handleProcessCrash') {
        // Strictly async — must reject.
        await expect(invoke()).rejects.toThrowError(expected)
      } else if (name === 'dispatchToolCall') {
        // Async but body throws synchronously before returning a Promise — in
        // V8 this surfaces as a sync throw from the async fn caller. Cover
        // both shapes.
        try {
          const ret = invoke()
          if (ret && typeof (ret as Promise<unknown>).then === 'function') {
            await expect(ret as Promise<unknown>).rejects.toThrowError(
              expected,
            )
          } else {
            // Should not happen — fail loud.
            throw new Error('expected dispatchToolCall to return a Promise')
          }
        } catch (err) {
          // Sync-throw branch (older runtimes).
          expect((err as Error).message).toMatch(expected)
        }
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
