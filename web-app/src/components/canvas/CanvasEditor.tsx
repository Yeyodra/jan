/**
 * CanvasEditor — the ONLY component in the codebase that imports
 * `@excalidraw/excalidraw` directly. Every consumer reaches Excalidraw
 * through this wrapper.
 *
 * The Excalidraw bundle is ~1.2 MB; we lazy-import it via React.lazy so the
 * chunk only ships when this component actually mounts (which currently
 * happens on the `/canvas/$canvasId` route — see T12).
 *
 * Contract (kept stable for T11/T12/T13/T14/T15/T22 consumers):
 *   - `initialScene` seeds the editor on first mount; subsequent updates
 *     should be applied via the imperative API surfaced through `onApiReady`.
 *   - `onChange` is the change feed used by the auto-save effect (T14).
 *   - `onApiReady` fires exactly once when the imperative API is first
 *     handed to us by Excalidraw. Subsequent re-renders do NOT re-fire it.
 *   - `theme` is forwarded directly; the next-themes sync hook lives in T13.
 */
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type {
  ExcalidrawImperativeAPI,
  AppState,
  BinaryFiles,
  Collaborator,
  SocketId,
} from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'

import { cn } from '@/lib/utils'

import '@excalidraw/excalidraw/index.css'

// Lazy-import the Excalidraw component so its ~1.2 MB chunk only loads when
// CanvasEditor mounts. The named export is unwrapped into a default export so
// React.lazy can consume it.
const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
)

/** Loose seed shape — the canonical `CanvasScene` is in `@/types/canvas`. */
export type CanvasEditorInitialScene = {
  elements: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export type CanvasEditorChangeHandler = (
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) => void

export type CanvasEditorApiReadyHandler = (api: ExcalidrawImperativeAPI) => void

export interface CanvasEditorProps {
  /**
   * Scene to hydrate on first mount. Re-rendering with a new value does NOT
   * automatically reload the scene — call `excalidrawAPI.updateScene(...)`
   * via the api handed off through `onApiReady` instead.
   */
  initialScene?: CanvasEditorInitialScene
  /** Forwarded to Excalidraw's `theme` prop. T13 wires this to next-themes. */
  theme?: 'light' | 'dark'
  /** Change feed for auto-save (T14). */
  onChange?: CanvasEditorChangeHandler
  /** Fires exactly once when the imperative API is first available. */
  onApiReady?: CanvasEditorApiReadyHandler
  /**
   * Forwarded to Excalidraw's `viewModeEnabled` prop. T20 wires this to the
   * orchestrator's manual-edit lock so an in-flight AI batch can freeze
   * editing without disabling the rest of the UI. Defaults to `false`
   * (interactive editing) so existing call sites and tests keep their
   * behaviour.
   */
  viewModeEnabled?: boolean
  className?: string
}

/**
 * Lightweight skeleton shown while the lazy chunk is loading. Kept inline
 * (rather than exported) so consumers can't accidentally render it elsewhere
 * — it's tightly coupled to the editor's "loading" state.
 */
function CanvasEditorSkeleton() {
  return (
    <div
      data-slot="canvas-editor-skeleton"
      className="bg-accent/40 animate-pulse rounded-md h-full w-full min-h-[480px]"
      aria-hidden="true"
    />
  )
}

/**
 * Friendly fallback rendered when the lazy import rejects (e.g. the chunk
 * fails to download because the user is offline). T24 will polish copy and
 * wire telemetry; this is the minimal safety net.
 */
function CanvasEditorErrorFallback({ error }: { error: Error }) {
  return (
    <div
      role="alert"
      className="flex h-full w-full min-h-[480px] flex-col items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center"
    >
      <p className="text-sm font-medium text-destructive">
        Failed to load the canvas editor.
      </p>
      <p className="text-xs text-muted-foreground">
        {error.message || 'Unknown error'}
      </p>
    </div>
  )
}

interface BoundaryState {
  error: Error | null
}

/**
 * Tiny error boundary scoped to the lazy import. React 19 still requires
 * boundaries to be class components, so we keep this minimal and local.
 */
class CanvasEditorErrorBoundary extends Component<
  { children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surface to console; richer telemetry lives in T24.
    console.error('[CanvasEditor] failed to mount:', error)
  }

  render() {
    if (this.state.error) {
      return <CanvasEditorErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}

/**
 * Shape of the seed object we hand to Excalidraw. We intentionally type
 * `appState.collaborators` as a real `Map` here so the runtime invariant is
 * visible at the type layer — Excalidraw 0.18.x calls `.forEach(...)` on this
 * field unconditionally and crashes on plain objects / `undefined`.
 */
type NormalizedInitialScene = {
  elements: readonly unknown[]
  appState: Record<string, unknown> & {
    collaborators: Map<SocketId, Collaborator>
  }
  files?: Record<string, unknown>
}

/**
 * Excalidraw 0.18.x expects `appState.collaborators` to be a real `Map`.
 * Our persisted scenes store `appState` as a JSON-serialisable plain object
 * (the `collaborators` key is typically absent or `[]`, since `Map` doesn't
 * survive `JSON.stringify`). This helper hydrates the field into a `Map` so
 * Excalidraw's internal `.forEach(...)` calls don't crash.
 *
 * Accepts: `Map` (already correct), array of `[id, info]` entries, plain
 * object map, or missing — coerces all to a real `Map<SocketId, Collaborator>`.
 */
function normalizeInitialScene(
  scene: CanvasEditorInitialScene | undefined,
): NormalizedInitialScene | undefined {
  if (!scene) return undefined
  const appState = scene.appState ?? {}
  const incoming = (appState as { collaborators?: unknown }).collaborators
  let collaborators: Map<SocketId, Collaborator>
  if (incoming instanceof Map) {
    collaborators = incoming as Map<SocketId, Collaborator>
  } else if (Array.isArray(incoming)) {
    collaborators = new Map(
      incoming as ReadonlyArray<readonly [SocketId, Collaborator]>,
    )
  } else if (incoming && typeof incoming === 'object') {
    // `SocketId` is a branded `string`, so `Object.entries` (which yields
    // `[string, V][]`) needs an `unknown` hop before we can hand it to `Map`.
    collaborators = new Map(
      Object.entries(
        incoming as Record<string, Collaborator>,
      ) as unknown as ReadonlyArray<readonly [SocketId, Collaborator]>,
    )
  } else {
    collaborators = new Map()
  }
  return {
    elements: scene.elements,
    appState: { ...appState, collaborators },
    files: scene.files,
  }
}

export function CanvasEditor({
  initialScene,
  theme,
  onChange,
  onApiReady,
  viewModeEnabled = false,
  className,
}: CanvasEditorProps) {
  // Snapshot the initial scene exactly once. Excalidraw's `initialData` is
  // consumed on first mount only; subsequent prop changes must flow through
  // the imperative API. We pass the seed through `normalizeInitialScene` here
  // (lazy ref init runs exactly once) so the boundary owns the runtime-shape
  // contract — the store stays JSON-friendly and never has to know about
  // Excalidraw's `Map`-typed `collaborators` field.
  const initialDataRef = useRef<NormalizedInitialScene | undefined>(undefined)
  if (initialDataRef.current === undefined) {
    initialDataRef.current = normalizeInitialScene(initialScene)
  }
  // Track whether we've already handed the imperative API to the parent so
  // we never fire `onApiReady` twice.
  const apiNotifiedRef = useRef(false)
  // Hold onto the API locally so future props (e.g. theme sync in T13) can
  // still dispatch imperative calls if needed.
  const [, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)

  const handleApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      setExcalidrawApi(api)
      if (!apiNotifiedRef.current) {
        apiNotifiedRef.current = true
        onApiReady?.(api)
      }
    },
    [onApiReady],
  )

  // Reset the "notified" flag if the parent swaps in a different handler.
  // This is mostly defensive — typical consumers pass a stable callback.
  useEffect(() => {
    apiNotifiedRef.current = false
  }, [onApiReady])

  type ExcalidrawInitialData = ComponentProps<typeof Excalidraw>['initialData']

  return (
    <div
      data-slot="canvas-editor"
      className={cn(
        'relative h-full w-full min-h-[480px] overflow-hidden',
        className,
      )}
    >
      <CanvasEditorErrorBoundary>
        <Suspense fallback={<CanvasEditorSkeleton />}>
          <Excalidraw
            initialData={
              initialDataRef.current as unknown as ExcalidrawInitialData
            }
            theme={theme}
            viewModeEnabled={viewModeEnabled}
            onChange={onChange}
            excalidrawAPI={handleApi}
          />
        </Suspense>
      </CanvasEditorErrorBoundary>
    </div>
  )
}

export default CanvasEditor
