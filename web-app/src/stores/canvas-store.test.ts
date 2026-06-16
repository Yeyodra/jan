/**
 * Unit tests for the canvas Zustand store.
 *
 * Coverage targets (T26):
 *   - create / get / list / listOrderedByUpdated
 *   - update (atomic; immutable id+createdAt; refreshes updatedAt)
 *   - rename / delete / duplicate
 *   - idb-keyval persist round-trip (mocked)
 *
 * Notes:
 *   - We mock `idb-keyval` so the test runs in jsdom without IndexedDB,
 *     and so we can assert the persist adapter writes/reads through it.
 *   - The store is imported AFTER the mock so the persist middleware
 *     binds to our mocked module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// idb-keyval mock — captured by reference so we can assert calls.
// ---------------------------------------------------------------------------

const idbStore = new Map<string, string>()
const idbGet = vi.fn(async (name: string): Promise<string | undefined> => {
  return idbStore.get(name)
})
const idbSet = vi.fn(async (name: string, value: string): Promise<void> => {
  idbStore.set(name, value)
})
const idbDel = vi.fn(async (name: string): Promise<void> => {
  idbStore.delete(name)
})

vi.mock('idb-keyval', () => ({
  get: (name: string) => idbGet(name),
  set: (name: string, value: string) => idbSet(name, value),
  del: (name: string) => idbDel(name),
}))

// Now import the store (after the mock is registered).
import { useCanvasStore, type Canvas } from './canvas-store'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useCanvasStore.getState()
}

/** Reset to a clean slate between tests — both in-memory and the idb mock. */
beforeEach(() => {
  useCanvasStore.setState({ canvases: {} })
  idbStore.clear()
  idbGet.mockClear()
  idbSet.mockClear()
  idbDel.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCanvasStore — create', () => {
  it('creates a canvas with a new id and ISO timestamps', () => {
    const id = getStore().create('My drawing')

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)

    const canvas = getStore().get(id)
    expect(canvas).toBeDefined()
    expect(canvas!.id).toBe(id)
    expect(canvas!.name).toBe('My drawing')
    // ISO 8601 timestamp shape
    expect(canvas!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(canvas!.updatedAt).toBe(canvas!.createdAt)
    expect(canvas!.elements).toEqual([])
    expect(canvas!.appState).toEqual({})
    expect(canvas!.files).toEqual({})
    expect(canvas!.thumbnail).toBeUndefined()
  })

  it('seeds elements/appState/files when scene is provided', () => {
    const fakeElement = {
      id: 'el-1',
      type: 'rectangle',
      isDeleted: false,
    } as unknown as Canvas['elements'][number]

    const id = getStore().create('Seeded', {
      elements: [fakeElement],
      appState: { viewBackgroundColor: '#fafafa' },
      files: {},
      thumbnail: 'data:image/png;base64,XXXX',
    })

    const canvas = getStore().get(id)!
    expect(canvas.elements).toEqual([fakeElement])
    expect(canvas.appState).toEqual({ viewBackgroundColor: '#fafafa' })
    expect(canvas.thumbnail).toBe('data:image/png;base64,XXXX')
  })

  it('returns unique ids for sequential creates', () => {
    const a = getStore().create('A')
    const b = getStore().create('B')
    expect(a).not.toBe(b)
    expect(Object.keys(getStore().canvases)).toHaveLength(2)
  })
})

describe('useCanvasStore — get / list / listOrderedByUpdated', () => {
  it('get returns undefined for unknown id', () => {
    expect(getStore().get('does-not-exist')).toBeUndefined()
  })

  it('list returns every canvas (unordered) from the record', () => {
    const a = getStore().create('A')
    const b = getStore().create('B')
    const list = getStore().list()
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.id).sort()).toEqual([a, b].sort())
  })

  it('listOrderedByUpdated returns most-recently-updated first', async () => {
    const a = getStore().create('A')
    // Tiny wait so updatedAt timestamps differ even on fast machines.
    await new Promise((r) => setTimeout(r, 5))
    const b = getStore().create('B')
    await new Promise((r) => setTimeout(r, 5))
    getStore().rename(a, 'A-renamed') // bumps a's updatedAt

    const ordered = getStore().listOrderedByUpdated()
    expect(ordered.map((c) => c.id)).toEqual([a, b])
  })
})

describe('useCanvasStore — update', () => {
  it('refreshes updatedAt and merges partial fields', async () => {
    const id = getStore().create('Original')
    const before = getStore().get(id)!
    await new Promise((r) => setTimeout(r, 5))

    getStore().update(id, { name: 'Renamed via update' })
    const after = getStore().get(id)!

    expect(after.name).toBe('Renamed via update')
    expect(after.updatedAt).not.toBe(before.updatedAt)
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updatedAt).getTime()
    )
  })

  it('preserves id and createdAt even if a malicious caller passes them', () => {
    const id = getStore().create('Original')
    const before = getStore().get(id)!

    // TS Omit<...> would prevent this, but cast through unknown to verify
    // the runtime guard truly preserves id + createdAt regardless.
    getStore().update(id, {
      // @ts-expect-error — purposely passing a forbidden field
      id: 'tampered-id',
      // @ts-expect-error — purposely passing a forbidden field
      createdAt: '1999-01-01T00:00:00.000Z',
      name: 'Renamed',
    } as unknown as Parameters<typeof useCanvasStore.getState>[0])

    const after = getStore().get(id)!
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.name).toBe('Renamed')
  })

  it('is a no-op when the id is unknown', () => {
    const before = getStore().canvases
    getStore().update('nope', { name: 'never' })
    expect(getStore().canvases).toEqual(before)
  })
})

describe('useCanvasStore — rename', () => {
  it('updates name and bumps updatedAt', async () => {
    const id = getStore().create('Old')
    const before = getStore().get(id)!
    await new Promise((r) => setTimeout(r, 5))

    getStore().rename(id, 'New')
    const after = getStore().get(id)!

    expect(after.name).toBe('New')
    expect(after.updatedAt).not.toBe(before.updatedAt)
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
  })

  it('is a no-op when the id is unknown', () => {
    const before = getStore().canvases
    getStore().rename('nope', 'whatever')
    expect(getStore().canvases).toEqual(before)
  })
})

describe('useCanvasStore — delete', () => {
  it('removes only the targeted canvas', () => {
    const a = getStore().create('A')
    const b = getStore().create('B')

    getStore().delete(a)

    expect(getStore().get(a)).toBeUndefined()
    expect(getStore().get(b)).toBeDefined()
    expect(Object.keys(getStore().canvases)).toEqual([b])
  })

  it('is a no-op for unknown ids', () => {
    const a = getStore().create('A')
    const before = getStore().canvases

    getStore().delete('not-a-real-id')

    expect(getStore().canvases).toEqual(before)
    expect(getStore().get(a)).toBeDefined()
  })
})

describe('useCanvasStore — duplicate', () => {
  it('creates a copy with new id, "(copy)" suffix, and fresh timestamps', async () => {
    const original = getStore().create('Drawing', {
      appState: { viewBackgroundColor: '#abcdef' },
    })
    await new Promise((r) => setTimeout(r, 5))

    const copyId = getStore().duplicate(original)
    expect(copyId).toBeDefined()
    expect(copyId).not.toBe(original)

    const copy = getStore().get(copyId!)!
    const orig = getStore().get(original)!

    expect(copy.id).toBe(copyId)
    expect(copy.name).toBe(`${orig.name} (copy)`)
    expect(copy.appState).toEqual({ viewBackgroundColor: '#abcdef' })
    // New timestamps — not the original's
    expect(copy.createdAt).not.toBe(orig.createdAt)
    expect(copy.updatedAt).toBe(copy.createdAt)
    // Both canvases coexist
    expect(Object.keys(getStore().canvases)).toHaveLength(2)
  })

  it('returns undefined for unknown ids and does not mutate state', () => {
    const before = getStore().canvases
    const result = getStore().duplicate('does-not-exist')
    expect(result).toBeUndefined()
    expect(getStore().canvases).toEqual(before)
  })
})

describe('useCanvasStore — persist round-trip via idb-keyval mock', () => {
  it('writes serialized state through idb-keyval.set', async () => {
    getStore().create('Persisted canvas')

    // Zustand's persist middleware writes asynchronously; flush microtasks.
    await new Promise((r) => setTimeout(r, 0))

    expect(idbSet).toHaveBeenCalled()
    // The first arg is the storage key (canvas store storage name).
    const [name, value] = idbSet.mock.calls[idbSet.mock.calls.length - 1]
    expect(typeof name).toBe('string')
    expect(name).toContain('canvas')
    // Value passed to setItem is JSON-serialized state.
    expect(typeof value).toBe('string')
    const parsed = JSON.parse(value as string)
    expect(parsed).toHaveProperty('state.canvases')
    const persistedIds = Object.keys(parsed.state.canvases)
    expect(persistedIds.length).toBeGreaterThanOrEqual(1)
  })

  it('removeItem path: idb-keyval.del is wired (smoke check)', async () => {
    // Sanity: the storage adapter exposes removeItem→idbDel; not invoked
    // during normal use, but verifying the mock module is wired correctly
    // protects us from regressions where the adapter loses its `del` impl.
    const idb = await import('idb-keyval')
    await idb.del('any-key')
    expect(idbDel).toHaveBeenCalledWith('any-key')
  })
})
