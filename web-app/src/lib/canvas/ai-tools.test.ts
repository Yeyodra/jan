/**
 * T28 — dispatch tests for the canvas AI tools (T18).
 *
 * Companion to `schemas.test.ts` (which covers the zod input/output schema
 * surface in isolation). This file exercises the *handler* side of each
 * `CanvasBuiltinTool` against the real Zustand store:
 *
 *   - module-level invariants (`mutatingToolNames`, `canvasBuiltinToolsByName`,
 *     `CANVAS_LIST_LIMIT`)
 *   - happy-path dispatch for each of the 5 tools
 *   - "unknown id" error paths (`canvas_read`, `canvas_update`, `canvas_delete`)
 *   - the `canvas_update` "at-least-one-of" zod refine, surfaced through the
 *     handler boundary
 *   - `canvas_list` ordering + 50-cap projection
 *
 * The store is exercised live (no mocks). State is reset to `{ canvases: {} }`
 * in `beforeEach` so each test starts clean. `idb-keyval` is mocked because
 * the store imports it eagerly via the `persist` middleware; the persistence
 * round-trip itself is already covered in `canvas-store.test.ts` (T26) and is
 * out of scope here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// idb-keyval mock — same pattern as canvas-store.test.ts (T26). The store
// pulls this in eagerly through its `persist` middleware; without the mock
// the test environment (jsdom) blows up on missing IndexedDB.
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

import {
  CANVAS_LIST_LIMIT,
  CANVAS_TOOL_SERVER,
  canvasBuiltinTools,
  canvasBuiltinToolsByName,
  mutatingToolNames,
} from './ai-tools'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: dispatch a tool by name with `args`. Throws if tool missing. */
const dispatch = async (toolName: string, args: unknown): Promise<unknown> => {
  const tool = canvasBuiltinToolsByName.get(toolName)
  if (!tool) throw new Error(`No such tool registered: ${toolName}`)
  return tool.handler(args)
}

/**
 * UUID-shaped id that is guaranteed never to be in the store. Used by the
 * "unknown id" error paths so the thrown `Error.message` ends with this
 * exact suffix and we can assert on it.
 */
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000abc'

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  useCanvasStore.setState({ canvases: {} })
  idbStore.clear()
})

// ---------------------------------------------------------------------------
// Module-level invariants
// ---------------------------------------------------------------------------

describe('canvas ai-tools — module surface', () => {
  it('exposes exactly 5 tools via canvasBuiltinTools and the by-name map', () => {
    expect(canvasBuiltinTools).toHaveLength(5)
    expect(canvasBuiltinToolsByName.size).toBe(5)
    const names = [...canvasBuiltinToolsByName.keys()].sort()
    expect(names).toEqual(
      [
        'canvas_create',
        'canvas_delete',
        'canvas_list',
        'canvas_read',
        'canvas_update',
      ].sort()
    )
  })

  it('marks exactly the three mutating tools and no others', () => {
    expect(mutatingToolNames.size).toBe(3)
    expect(mutatingToolNames.has('canvas_create')).toBe(true)
    expect(mutatingToolNames.has('canvas_update')).toBe(true)
    expect(mutatingToolNames.has('canvas_delete')).toBe(true)
    // Read-only tools must stay out of the approval set.
    expect(mutatingToolNames.has('canvas_list')).toBe(false)
    expect(mutatingToolNames.has('canvas_read')).toBe(false)
  })

  it('pins CANVAS_LIST_LIMIT to 50 and CANVAS_TOOL_SERVER to "canvas"', () => {
    expect(CANVAS_LIST_LIMIT).toBe(50)
    expect(CANVAS_TOOL_SERVER).toBe('canvas')
  })

  it('every tool tags itself with the canvas server and exposes a handler', () => {
    for (const tool of canvasBuiltinTools) {
      expect(tool.server).toBe(CANVAS_TOOL_SERVER)
      expect(typeof tool.handler).toBe('function')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeTypeOf('object')
    }
  })
})

// ---------------------------------------------------------------------------
// canvas_create
// ---------------------------------------------------------------------------

describe('canvas_create — handler', () => {
  it('creates a canvas, returns {id, name, createdAt}, and persists into the store', async () => {
    const result = (await dispatch('canvas_create', {
      name: 'Hello Canvas',
    })) as { id: string; name: string; createdAt: string }

    expect(result.name).toBe('Hello Canvas')
    expect(typeof result.id).toBe('string')
    expect(result.id.length).toBeGreaterThan(0)
    // ISO-8601 datetime with offset (matches the schema)
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

    // Store must contain the new record.
    const stored = useCanvasStore.getState().get(result.id)
    expect(stored).toBeDefined()
    expect(stored!.id).toBe(result.id)
    expect(stored!.name).toBe('Hello Canvas')
    expect(stored!.elements).toEqual([])
    expect(stored!.appState).toEqual({})
  })

  it('forwards an optional scene into the new canvas', async () => {
    const fakeElement = { id: 'el-1', type: 'rectangle', isDeleted: false }

    const result = (await dispatch('canvas_create', {
      name: 'Seeded Canvas',
      scene: {
        elements: [fakeElement],
        appState: { viewBackgroundColor: '#abcdef' },
      },
    })) as { id: string }

    const stored = useCanvasStore.getState().get(result.id)!
    expect(stored.elements).toEqual([fakeElement])
    expect(stored.appState).toEqual({ viewBackgroundColor: '#abcdef' })
  })

  it('rejects an empty name through the zod input schema', async () => {
    await expect(
      dispatch('canvas_create', { name: '' })
    ).rejects.toThrow(/canvas_create failed/i)
  })
})

// ---------------------------------------------------------------------------
// canvas_read
// ---------------------------------------------------------------------------

describe('canvas_read — handler', () => {
  it('returns the full canvas record (with scene wrapper, files stripped)', async () => {
    const fakeElement = { id: 'el-2', type: 'ellipse', isDeleted: false }
    const id = useCanvasStore.getState().create('Readable', {
      // Cast to `never` to bypass the store's tight Excalidraw element typing
      // — we only care that the shape round-trips through the handler.
      elements: [fakeElement] as never,
      appState: { viewBackgroundColor: '#112233' },
    })

    const result = (await dispatch('canvas_read', { id })) as {
      id: string
      name: string
      createdAt: string
      updatedAt: string
      scene: { elements: unknown[]; appState?: Record<string, unknown> }
    }

    expect(result.id).toBe(id)
    expect(result.name).toBe('Readable')
    expect(result.scene.elements).toEqual([fakeElement])
    expect(result.scene.appState).toEqual({ viewBackgroundColor: '#112233' })
    // The handler intentionally drops the `files` map from the scene to keep
    // the LLM context bounded.
    expect((result.scene as { files?: unknown }).files).toBeUndefined()
  })

  it('throws "Canvas not found: <id>" when the id is unknown', async () => {
    await expect(
      dispatch('canvas_read', { id: UNKNOWN_UUID })
    ).rejects.toThrow(`Canvas not found: ${UNKNOWN_UUID}`)
  })

  it('rejects a non-UUID id through the zod input schema', async () => {
    await expect(
      dispatch('canvas_read', { id: 'not-a-uuid' })
    ).rejects.toThrow(/canvas_read failed/i)
  })
})

// ---------------------------------------------------------------------------
// canvas_update
// ---------------------------------------------------------------------------

describe('canvas_update — handler', () => {
  it('renames the canvas, refreshes updatedAt, and leaves createdAt untouched', async () => {
    const id = useCanvasStore.getState().create('Original')
    const before = useCanvasStore.getState().get(id)!

    // Push the clock forward so updatedAt is observably different. Without
    // this the test occasionally races: same-millisecond updates would tie.
    await new Promise((r) => setTimeout(r, 5))

    const result = (await dispatch('canvas_update', {
      id,
      name: 'Renamed',
    })) as { id: string; updatedAt: string }

    const after = useCanvasStore.getState().get(id)!
    expect(after.name).toBe('Renamed')
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt).not.toBe(before.updatedAt)
    expect(result.id).toBe(id)
    expect(result.updatedAt).toBe(after.updatedAt)
  })

  it('updates the scene without touching the name', async () => {
    const id = useCanvasStore.getState().create('Keep-Name')
    const newElement = { id: 'el-3', type: 'rectangle', isDeleted: false }

    await dispatch('canvas_update', {
      id,
      scene: {
        elements: [newElement],
        appState: { zoom: { value: 2 } },
      },
    })

    const after = useCanvasStore.getState().get(id)!
    expect(after.name).toBe('Keep-Name')
    expect(after.elements).toEqual([newElement])
    expect(after.appState).toEqual({ zoom: { value: 2 } })
  })

  it('rejects an update with neither name nor scene (zod .refine)', async () => {
    const id = useCanvasStore.getState().create('Unchanged')

    await expect(dispatch('canvas_update', { id })).rejects.toThrow(
      /canvas_update failed/i
    )
  })

  it('throws "Canvas not found" when the id is unknown', async () => {
    await expect(
      dispatch('canvas_update', { id: UNKNOWN_UUID, name: 'whatever' })
    ).rejects.toThrow(`Canvas not found: ${UNKNOWN_UUID}`)
  })
})

// ---------------------------------------------------------------------------
// canvas_delete
// ---------------------------------------------------------------------------

describe('canvas_delete — handler', () => {
  it('hard-deletes the canvas and returns {id, deleted:true}', async () => {
    const id = useCanvasStore.getState().create('Doomed')
    expect(useCanvasStore.getState().get(id)).toBeDefined()

    const result = (await dispatch('canvas_delete', { id })) as {
      id: string
      deleted: boolean
    }

    expect(result).toEqual({ id, deleted: true })
    expect(useCanvasStore.getState().get(id)).toBeUndefined()
  })

  it('throws "Canvas not found" when the id is unknown', async () => {
    await expect(
      dispatch('canvas_delete', { id: UNKNOWN_UUID })
    ).rejects.toThrow(`Canvas not found: ${UNKNOWN_UUID}`)
  })
})

// ---------------------------------------------------------------------------
// canvas_list
// ---------------------------------------------------------------------------

describe('canvas_list — handler', () => {
  it('returns metadata sorted by updatedAt descending', async () => {
    // Seed three canvases at distinct timestamps. Manually rewrite the
    // timestamps after creation so we don't depend on wall-clock timing
    // resolution.
    const idA = useCanvasStore.getState().create('Older')
    const idB = useCanvasStore.getState().create('Middle')
    const idC = useCanvasStore.getState().create('Newest')

    useCanvasStore.setState((s) => ({
      canvases: {
        ...s.canvases,
        [idA]: { ...s.canvases[idA], updatedAt: '2025-01-01T00:00:00.000Z' },
        [idB]: { ...s.canvases[idB], updatedAt: '2025-06-01T00:00:00.000Z' },
        [idC]: { ...s.canvases[idC], updatedAt: '2025-12-01T00:00:00.000Z' },
      },
    }))

    const result = (await dispatch('canvas_list', {})) as {
      canvases: Array<{
        id: string
        name: string
        createdAt: string
        updatedAt: string
      }>
    }

    expect(result.canvases).toHaveLength(3)
    expect(result.canvases.map((c) => c.id)).toEqual([idC, idB, idA])
    // Each entry projects only the metadata fields — no `elements`/`scene`.
    expect(Object.keys(result.canvases[0]).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'updatedAt',
    ])
  })

  it('caps the result at 50 entries and returns the most-recently-updated', async () => {
    // Seed 51 canvases with monotonically increasing timestamps.
    const ids: string[] = []
    for (let i = 0; i < 51; i++) {
      ids.push(useCanvasStore.getState().create(`C${i}`))
    }
    useCanvasStore.setState((s) => {
      const next = { ...s.canvases }
      for (let i = 0; i < ids.length; i++) {
        // 2025-01-01 + i days; lexicographic order matches chronological.
        const day = String(i + 1).padStart(2, '0')
        next[ids[i]] = {
          ...next[ids[i]],
          // span across two months so we always have 2 digits
          updatedAt: `2025-0${i < 30 ? '1' : '2'}-${
            i < 30 ? day : String(i - 29).padStart(2, '0')
          }T00:00:00.000Z`,
        }
      }
      return { canvases: next }
    })

    const result = (await dispatch('canvas_list', {})) as {
      canvases: Array<{ id: string; updatedAt: string }>
    }

    expect(result.canvases).toHaveLength(50)
    // Top entry must be the freshest in the set.
    const allUpdatedAts = Object.values(useCanvasStore.getState().canvases)
      .map((c) => c.updatedAt)
      .sort()
      .reverse()
    expect(result.canvases[0].updatedAt).toBe(allUpdatedAts[0])
    // Result must be strictly non-increasing in updatedAt.
    for (let i = 1; i < result.canvases.length; i++) {
      expect(
        result.canvases[i - 1].updatedAt >= result.canvases[i].updatedAt
      ).toBe(true)
    }
    // The single oldest canvas must not appear in the truncated 50.
    const oldestId = ids[0]
    expect(result.canvases.some((c) => c.id === oldestId)).toBe(false)
  })

  it('returns an empty array when the store is empty', async () => {
    const result = (await dispatch('canvas_list', {})) as {
      canvases: unknown[]
    }
    expect(result.canvases).toEqual([])
  })
})
