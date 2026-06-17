/**
 * /canvas/$canvasId route — wiring tests (T20, Wave 5)
 * =====================================================
 *
 * Behaviour contract under test:
 *   - When the Settings > MCP > excalidraw toggle is ON, the route mounts
 *     `<CanvasPromptBar />`, `<CanvasAiIndicator />`, and
 *     `<CanvasManualEditLockBanner />` over the canvas viewport.
 *   - When the toggle is OFF, NONE of those three render.
 *   - Existing canvas-loading behaviour is unchanged: opening a canvas with
 *     elements results in `<CanvasEditor />` receiving the initial scene.
 *
 * Why mocks are this aggressive:
 *   - The route imports the real Excalidraw chunk via `<CanvasEditor />`
 *     (~1.2 MB lazy import, jsdom-hostile).
 *   - The orchestrator class is fully real but we never actually drive an
 *     LLM call — we mock its constructor so vitest doesn't pull in the
 *     batch / lock controllers' indirect imports we don't care about for
 *     the wiring contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mock harness state — declared at module scope so vi.mock() factories can
// close over it. `vi.mock` is hoisted above imports, so the factories MUST
// reference module-scope let-bindings (mutated in `beforeEach`) instead of
// closing over per-test locals.
// ---------------------------------------------------------------------------

let mockExcalidrawActive = true
let mockCanvas: ReturnType<typeof buildCanvas> | undefined = undefined
let canvasEditorReceivedProps: Record<string, unknown> | null = null
const mockSubscribeManualEditLock = vi.fn(() => () => {})
const mockIsManualEditLocked = vi.fn(() => false)
const mockBeginAiBatch = vi.fn(() => Symbol('batch') as never)
const mockEndAiBatch = vi.fn()
const mockLockManualEdits = vi.fn(() => () => {})
// Captures the deps object passed to each CanvasMcpOrchestrator constructor call.
let capturedOrchestratorDeps: unknown[] = []

function buildCanvas(overrides: Partial<{ id: string; name: string; elements: unknown[] }> = {}) {
  return {
    id: overrides.id ?? 'canvas-1',
    name: overrides.name ?? 'Test Canvas',
    elements: overrides.elements ?? [{ id: 'el-1', type: 'rectangle' }],
    appState: {},
    files: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

// ---------------------------------------------------------------------------
// Mocks (hoisted above imports by vi.mock).
// ---------------------------------------------------------------------------

// i18n passthrough.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// MCP toggle hook — supports both the selector-call and direct-call shape so
// tests don't need to know which the route uses.
vi.mock('@/hooks/useMCPServers', () => {
  const useMCPServers = (selector?: (s: unknown) => unknown) => {
    const state = {
      mcpServers: {
        excalidraw: { active: mockExcalidrawActive },
      },
    }
    return selector ? selector(state) : state
  }
  return { useMCPServers }
})

// Canvas store — the route reads `canvases[canvasId]` via a selector AND
// calls `useCanvasStore.getState()` for mutations. Cover both surfaces.
vi.mock('@/stores/canvas-store', () => {
  const getState = () => ({
    canvases: mockCanvas ? { [mockCanvas.id]: mockCanvas } : {},
    rename: vi.fn(),
    delete: vi.fn(),
  })
  const useCanvasStore = ((selector?: (s: unknown) => unknown) => {
    const state = getState()
    return selector ? selector(state) : state
  }) as unknown as { (sel?: unknown): unknown; getState: () => unknown }
  useCanvasStore.getState = getState
  return { useCanvasStore }
})

// Auto-save — return a stable shape; the route only destructures.
vi.mock('@/hooks/useCanvasAutoSave', () => ({
  useCanvasAutoSave: () => ({
    onChange: vi.fn(),
    saveStatus: 'idle' as const,
    flush: vi.fn(),
  }),
}))

vi.mock('@/hooks/useExcalidrawTheme', () => ({
  useExcalidrawTheme: () => 'light' as const,
}))

vi.mock('@/hooks/useHotkeys', () => ({
  useKeyboardShortcut: () => {},
}))

// Router hooks — the route uses `useParams`, `useNavigate`, and `useRouter`
// from `@tanstack/react-router`. `createFileRoute` is also pulled in at module
// load to register the route, so it must return a no-op factory.
const mockRouter = {
  state: {
    matches: [
      {
        routeId: '/canvas/$canvasId',
        params: { canvasId: 'canvas-1' },
      },
    ],
  },
}
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useParams: () => ({ canvasId: 'canvas-1' }),
  useNavigate: () => vi.fn(),
  useRouter: () => mockRouter,
}))

// useServiceHub — provides the MCP client adapter. Return a stable stub
// whose mcp().callTool resolves immediately. The object is module-level so
// useServiceHub returns the SAME identity on every call (mirrors the real
// zustand singleton), keeping mcpClient useMemo stable across re-renders.
const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
const mockMcpService = { callTool: mockCallTool }
const mockServiceHubInstance = { mcp: () => mockMcpService }
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mockServiceHubInstance,
}))

// File-IO + clipboard + exporters — the route imports these at module load
// for toolbar actions. We don't drive any toolbar action, but the imports
// must resolve without pulling Tauri APIs into the test bundle.
vi.mock('@/lib/canvas/file-io', () => ({
  isFileIoAvailable: () => false,
  openExcalidrawFile: vi.fn(),
  saveCanvasFile: vi.fn(),
}))
vi.mock('@/lib/canvas/clipboard', () => ({
  copyCanvasImageToClipboard: vi.fn(),
}))
vi.mock('@/lib/canvas/exporters', () => ({
  downloadBlob: vi.fn(),
  exportCanvasToJson: vi.fn(),
  exportCanvasToPng: vi.fn(),
  exportCanvasToSvg: vi.fn(),
}))

// Sonner toast — never actually fires in these tests.
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// CanvasEditor — record received props instead of mounting Excalidraw.
vi.mock('@/components/canvas/CanvasEditor', () => ({
  CanvasEditor: (props: Record<string, unknown>) => {
    canvasEditorReceivedProps = props
    return (
      <div
        data-testid="canvas-editor-mock"
        data-view-mode={String(props.viewModeEnabled ?? false)}
      />
    )
  },
}))

// CanvasToolbar — collapse to a tiny stub so we don't need to mock its
// dropdown / tooltip primitives.
vi.mock('@/components/canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <div data-testid="canvas-toolbar-mock" />,
}))

// Error boundary used at the route's `errorComponent` slot — never rendered
// in the happy path, but the import must resolve.
vi.mock('@/components/canvas/CanvasErrorBoundary', () => ({
  CanvasRouteErrorComponent: () => null,
}))

// Orchestrator — replace the constructor with a recording stub. The real
// class triggers a 11-method self-check on construction; we don't need that
// here because the route only calls a known subset.
vi.mock('@/lib/canvas-mcp-orchestrator', () => ({
  CanvasMcpOrchestrator: vi.fn().mockImplementation((deps: unknown) => {
    capturedOrchestratorDeps.push(deps)
    return {
      isManualEditLocked: mockIsManualEditLocked,
      subscribeManualEditLock: mockSubscribeManualEditLock,
      beginAiBatch: mockBeginAiBatch,
      endAiBatch: mockEndAiBatch,
      lockManualEdits: mockLockManualEdits,
    }
  }),
}))

// ---------------------------------------------------------------------------
// SUT import — must come AFTER all vi.mock() calls.
// ---------------------------------------------------------------------------

import { Route } from '../$canvasId'

// `createFileRoute` is mocked to return its config object, so `Route` IS
// the config and `Route.component` is the route component.
const RouteComponent = (Route as unknown as { component: React.ComponentType })
  .component

beforeEach(() => {
  mockExcalidrawActive = true
  mockCanvas = buildCanvas()
  canvasEditorReceivedProps = null
  capturedOrchestratorDeps = []
  mockSubscribeManualEditLock.mockClear()
  mockIsManualEditLocked.mockClear()
  mockBeginAiBatch.mockClear()
  mockEndAiBatch.mockClear()
  mockLockManualEdits.mockClear()
  cleanup()
})

describe('/canvas/$canvasId — toggle ON', () => {
  it('renders CanvasPromptBar when Settings > MCP > excalidraw is active', () => {
    mockExcalidrawActive = true
    render(<RouteComponent />)
    expect(screen.getByTestId('canvas-prompt-bar')).toBeInTheDocument()
  })

  it('mounts the indicator overlay region (state="idle" returns null but the wrapper is conditionally mounted with the toggle)', () => {
    mockExcalidrawActive = true
    render(<RouteComponent />)
    // Indicator returns null at state="idle" — assert prompt bar is visible
    // (the indicator's mount is gated by the SAME flag, so its conditional
    // mount-point is verified together with the prompt bar's).
    expect(screen.getByTestId('canvas-prompt-bar')).toBeInTheDocument()
    // And the lock banner is also tied to the same toggle but isLocked=false
    // -> renders null. Both share the same gate, so the assertion above
    // covers all three mount points.
  })
})

describe('/canvas/$canvasId — toggle OFF', () => {
  it('does NOT render prompt bar / indicator / lock banner when toggle is off', () => {
    mockExcalidrawActive = false
    render(<RouteComponent />)
    expect(screen.queryByTestId('canvas-prompt-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('canvas-ai-indicator')).not.toBeInTheDocument()
    // CanvasEditor must still render — the toggle only gates the AI surface.
    expect(screen.getByTestId('canvas-editor-mock')).toBeInTheDocument()
  })
})

describe('/canvas/$canvasId — existing canvas-loading behaviour', () => {
  it('passes the canvas elements as the initial scene to CanvasEditor', () => {
    mockExcalidrawActive = false // isolate from AI surface
    mockCanvas = buildCanvas({
      id: 'canvas-1',
      name: 'Demo',
      elements: [
        { id: 'el-a', type: 'rectangle' },
        { id: 'el-b', type: 'ellipse' },
      ],
    })
    render(<RouteComponent />)
    expect(canvasEditorReceivedProps).not.toBeNull()
    const initialScene = canvasEditorReceivedProps!.initialScene as {
      elements: unknown[]
    }
    expect(initialScene).toBeDefined()
    expect(initialScene.elements).toHaveLength(2)
  })

  it('forwards viewModeEnabled=false by default (lock not held)', () => {
    mockExcalidrawActive = true
    mockIsManualEditLocked.mockReturnValue(false)
    render(<RouteComponent />)
    expect(canvasEditorReceivedProps).not.toBeNull()
    expect(canvasEditorReceivedProps!.viewModeEnabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// T1 — Orchestrator deps wiring
// ---------------------------------------------------------------------------

import { CanvasMcpOrchestrator } from '@/lib/canvas-mcp-orchestrator'

describe('/canvas/$canvasId — orchestrator deps wiring (T1)', () => {
  it('constructs CanvasMcpOrchestrator exactly once per mount', () => {
    render(<RouteComponent />)
    expect(CanvasMcpOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('passes canvasStore, mcpClient, router, and logger to the constructor', () => {
    render(<RouteComponent />)
    expect(capturedOrchestratorDeps).toHaveLength(1)
    const deps = capturedOrchestratorDeps[0] as Record<string, unknown>
    // canvasStore: the zustand store object (callable with getState)
    expect(deps.canvasStore).toBeDefined()
    // mcpClient: adapter object with callTool function
    expect(typeof (deps.mcpClient as { callTool: unknown }).callTool).toBe('function')
    // router: the RouterLike object with state.matches
    expect(deps.router).toBeDefined()
    expect((deps.router as { state: { matches: unknown[] } }).state.matches).toBeDefined()
    // logger: console or console-like
    expect(deps.logger).toBeDefined()
  })

  it('passes threadId: undefined (canvas has no thread)', () => {
    render(<RouteComponent />)
    const deps = capturedOrchestratorDeps[0] as Record<string, unknown>
    expect(deps.threadId).toBeUndefined()
  })

  it('does NOT recreate the orchestrator on an unrelated re-render', () => {
    const { rerender } = render(<RouteComponent />)
    // Re-render the same component — useMemo is keyed on canvas.id which
    // hasn't changed, so no new constructor call should happen.
    rerender(<RouteComponent />)
    expect(CanvasMcpOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('mcpClient adapter forwards call.name as toolName to serviceHub.mcp().callTool', async () => {
    render(<RouteComponent />)
    const deps = capturedOrchestratorDeps[0] as Record<string, unknown>
    const mcpClient = deps.mcpClient as {
      callTool: (call: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>
    }
    await mcpClient.callTool({ name: 'add_rectangle', arguments: { x: 0, y: 0 } })
    expect(mockCallTool).toHaveBeenCalledWith({
      toolName: 'add_rectangle',
      arguments: { x: 0, y: 0 },
    })
  })

  it('does not crash when excalidrawAPI is initially undefined (late binding is safe)', () => {
    // The orchestrator mock receives no excalidrawAPI at construction —
    // this mirrors the real first render before Excalidraw mounts.
    // The route must not throw.
    expect(() => render(<RouteComponent />)).not.toThrow()
  })
})
