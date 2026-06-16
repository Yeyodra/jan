/**
 * Canvas library store.
 *
 * Multi-canvas Zustand store, persisted to IndexedDB through a custom
 * `StateStorage` adapter that wraps `idb-keyval`. The adapter is async, so
 * it is plugged into Zustand via `createJSONStorage` (which natively supports
 * async storage engines).
 *
 * This store is the single source of truth for the canvas library:
 * the list view, detail view, AI tool calls (canvas_create / canvas_read /
 * canvas_update / canvas_list / canvas_delete), and any future export-to-chat
 * flow all funnel through these actions, which keeps writes serialized in JS.
 *
 * Type ownership: shared structural types (Canvas, CanvasScene, …) live in
 * `@/types/canvas` — the SoT shared with the editor, list/detail routes and
 * the AI tool layer. The store re-exports them under their pre-T06 names
 * for backward compatibility with consumers that imported them from here
 * (e.g. `useCanvasAutoSave.ts`).
 */
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'
import { create } from 'zustand'
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

import type {
  Canvas,
  CanvasElement,
  CanvasScene as CanvasSceneShared,
} from '@/types/canvas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Re-export shared types under their canonical names so existing consumers
// (`@/stores/canvas-store`) don't need to be rewritten en masse.
export type { Canvas, CanvasElement }

/** Excalidraw's full `AppState`; we always work with a partial slice. */
export type CanvasAppState = Partial<AppState>

/** Excalidraw's `BinaryFiles` — file id → binary file metadata. */
export type CanvasBinaryFiles = BinaryFiles
/** Single binary file entry as understood by Excalidraw. */
export type CanvasBinaryFile = BinaryFiles[string]

/**
 * Partial scene shape accepted by `create()` so callers (UI + AI tool calls)
 * can seed a brand-new canvas with content. Everything is optional.
 *
 * This is the store-side variant of `CanvasScene` (every field optional). The
 * editor-side `CanvasScene` (in `@/types/canvas`) requires all three fields
 * because Excalidraw's `updateScene` does too.
 */
export type CanvasScene = Partial<CanvasSceneShared> & {
  thumbnail?: string
}

// ---------------------------------------------------------------------------
// IndexedDB storage adapter
// ---------------------------------------------------------------------------
//
// Zustand's `persist` middleware accepts any `StateStorage`-shaped object.
// `idb-keyval` already gives us async `get` / `set` / `del` functions that
// store arbitrary structured-cloneable values under a string key. Because we
// wrap this with `createJSONStorage(...)`, the middleware serializes our
// state to a JSON string before handing it to `setItem`, and parses it back
// in `getItem`. So under the hood the adapter is just a string-in, string-out
// passthrough on top of IndexedDB.
//
// All three methods return Promises — Zustand awaits them on rehydration and
// during writes, which is exactly what we want for IndexedDB's async API.
const idbStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const value = await idbGet<string>(name)
      return value ?? null
    } catch {
      return null
    }
  },
  setItem: async (name, value) => {
    try {
      await idbSet(name, value)
    } catch {
      // Silently swallow — the in-memory store is still valid even if the
      // disk write fails (e.g. quota exceeded). Future write attempts will
      // retry naturally.
    }
  },
  removeItem: async (name) => {
    try {
      await idbDel(name)
    } catch {
      // ditto
    }
  },
}

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'jan-canvas-store-v1'
const STORE_VERSION = 1
const COPY_SUFFIX = ' (copy)'

const generateId = (): string => {
  // `crypto.randomUUID` is available in modern Chromium-based webviews
  // (Tauri/WebView2). Falls back to a v4-shaped string only as a guard.
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  // RFC4122 v4 fallback (extremely unlikely path).
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
}

const nowIso = (): string => new Date().toISOString()

type CanvasStateShape = {
  /** Canvases keyed by id for O(1) `get(id)` lookup. */
  canvases: Record<string, Canvas>
}

type CanvasStoreActions = {
  /** Returns the stable record. Use `listOrderedByUpdated` for the list view. */
  list: () => Canvas[]
  /** Stable, sorted view (most recently updated first). */
  listOrderedByUpdated: () => Canvas[]
  /** Returns the canvas or `undefined`. */
  get: (id: string) => Canvas | undefined
  /** Creates a new canvas; returns the new id (caller often navigates to it). */
  create: (name: string, scene?: CanvasScene) => string
  /**
   * Atomic update: reads the current canvas, applies `partial`, refreshes
   * `updatedAt`, then writes. Concurrent calls are serialized through
   * Zustand's set queue.
   */
  update: (id: string, partial: Partial<Omit<Canvas, 'id' | 'createdAt'>>) => void
  rename: (id: string, name: string) => void
  delete: (id: string) => void
  /** Duplicates a canvas with `(copy)` suffix; returns the new id. */
  duplicate: (id: string) => string | undefined
}

type CanvasStore = CanvasStateShape & CanvasStoreActions

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCanvasStore = create<CanvasStore>()(
  persist(
    (set, get) => ({
      canvases: {},

      list: () => Object.values(get().canvases),

      listOrderedByUpdated: () =>
        Object.values(get().canvases).sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
        ),

      get: (id) => get().canvases[id],

      create: (name, scene) => {
        const id = generateId()
        const ts = nowIso()
        const canvas: Canvas = {
          id,
          name,
          createdAt: ts,
          updatedAt: ts,
          elements: scene?.elements ?? [],
          appState: scene?.appState ?? {},
          files: scene?.files ?? {},
          thumbnail: scene?.thumbnail,
        }
        set((s) => ({
          canvases: { ...s.canvases, [id]: canvas },
        }))
        return id
      },

      update: (id, partial) => {
        set((s) => {
          const existing = s.canvases[id]
          if (!existing) return s
          // `id` and `createdAt` are immutable; spread `partial` first so any
          // accidental ones get overwritten by the canonical values.
          const next: Canvas = {
            ...existing,
            ...partial,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: nowIso(),
          }
          return {
            canvases: { ...s.canvases, [id]: next },
          }
        })
      },

      rename: (id, name) => {
        set((s) => {
          const existing = s.canvases[id]
          if (!existing) return s
          return {
            canvases: {
              ...s.canvases,
              [id]: { ...existing, name, updatedAt: nowIso() },
            },
          }
        })
      },

      delete: (id) => {
        set((s) => {
          if (!(id in s.canvases)) return s
          // Hard-delete is fine here — no other store holds a FK to canvas
          // ids, and the insert-to-chat path that previously copied rendered
          // images was scoped out (see notepads/canvas-feature/issues.md).
          // (See decisions.md / T05 for the original rationale.)
          const next = { ...s.canvases }
          delete next[id]
          return { canvases: next }
        })
      },

      duplicate: (id) => {
        const original = get().canvases[id]
        if (!original) return undefined
        const newId = generateId()
        const ts = nowIso()
        const copy: Canvas = {
          ...original,
          id: newId,
          name: `${original.name}${COPY_SUFFIX}`,
          createdAt: ts,
          updatedAt: ts,
        }
        set((s) => ({
          canvases: { ...s.canvases, [newId]: copy },
        }))
        return newId
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => idbStorage),
      // Only persist data — actions are recreated on every load.
      partialize: (state) => ({ canvases: state.canvases }),
      // No-op migration today; bump `STORE_VERSION` and add cases here on
      // future schema changes.
      migrate: (persistedState) => {
        return persistedState as CanvasStateShape
      },
    }
  )
)
