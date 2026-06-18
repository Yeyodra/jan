/**
 * Canvas detail route — `/canvas/$canvasId`.
 *
 * Composition (T12):
 *   - Reads `canvasId` from the URL.
 *   - Subscribes to {@link useCanvasStore} so renames/updates from anywhere
 *     in the app re-render this route.
 *   - Snapshots the FIRST `canvas` it sees into a ref keyed by id; that
 *     snapshot becomes Excalidraw's `initialScene`. Subsequent re-renders
 *     do NOT reload the scene — the editor is hydrated once and then the
 *     imperative API + auto-save handle drift.
 *   - Wires {@link useExcalidrawTheme} (T13) into `<CanvasEditor theme=...>`.
 *   - Wires {@link useCanvasAutoSave} (T14) → editor `onChange` + toolbar
 *     `saveStatus`.
 *   - Toolbar actions are dispatched through a single `handleAction` switch
 *     that reaches into the T15/T16/T17 helpers.
 *
 * Save strategy:
 *   - Desktop (Tauri): native save dialog via {@link saveCanvasFile}.
 *   - Web fallback: {@link downloadBlob} (PNG) or anchor-download a generated
 *     Blob for SVG/JSON.
 *   - PNG on desktop currently routes through `downloadBlob` because the
 *     in-house `write_file_sync` Rust command is UTF-8 only (see
 *     `lib/canvas/file-io.ts` header).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  useNavigate,
  useParams,
  useRouter,
} from '@tanstack/react-router'
import { toast } from 'sonner'

import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useCanvasStore } from '@/stores/canvas-store'
import { useCanvasAutoSave } from '@/hooks/useCanvasAutoSave'
import { useExcalidrawTheme } from '@/hooks/useExcalidrawTheme'
import { useKeyboardShortcut } from '@/hooks/useHotkeys'
import { useMCPServers } from '@/hooks/useMCPServers'
import {
  CanvasEditor,
  type CanvasEditorInitialScene,
} from '@/components/canvas/CanvasEditor'
import {
  CanvasToolbar,
  type CanvasToolbarAction,
} from '@/components/canvas/CanvasToolbar'
import { CanvasRouteErrorComponent } from '@/components/canvas/CanvasErrorBoundary'
import { CanvasPromptBar } from '@/components/canvas/CanvasPromptBar'
import { CanvasAiIndicator } from '@/components/canvas/CanvasAiIndicator'
import { CanvasManualEditLockBanner } from '@/components/canvas/CanvasManualEditLockBanner'
import { CanvasErrorBanner } from '@/components/canvas/CanvasErrorBanner'
import {
  CanvasModelPicker,
  type ModelInfo,
} from '@/components/canvas/CanvasModelPicker'
import { CanvasMcpOrchestrator } from '@/lib/canvas-mcp-orchestrator'
import type {
  OrchestratorState,
  McpToolCall,
  McpToolResult,
} from '@/lib/canvas-mcp-orchestrator/types'
import { createBatchApprovalToken } from '@/lib/canvas-mcp-orchestrator/approval'
import { applyMutationsToCanvas } from '@/lib/canvas-mcp-orchestrator/apply'
import {
  EXCALIDRAW_MUTATING_TOOLS,
  EXCALIDRAW_READONLY_TOOLS,
} from '@/lib/canvas-mcp-orchestrator/curated-tools'
import { useCanvasChat, type ToolOutput } from '@/hooks/useCanvasChat'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  downloadBlob,
  exportCanvasToJson,
  exportCanvasToPng,
  exportCanvasToSvg,
} from '@/lib/canvas/exporters'
import { copyCanvasImageToClipboard } from '@/lib/canvas/clipboard'
import {
  isFileIoAvailable,
  openExcalidrawFile,
  saveCanvasFile,
} from '@/lib/canvas/file-io'
import type { Canvas, CanvasScene } from '@/types/canvas'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/canvas/$canvasId')({
  component: CanvasDetailRoute,
  errorComponent: CanvasRouteErrorComponent,
})

function CanvasDetailRoute() {
  const { canvasId } = useParams({ from: '/canvas/$canvasId' })
  // Live subscription — renames / duplicates / external updates re-render us.
  const canvas = useCanvasStore((s) => s.canvases[canvasId])

  if (!canvas) {
    return <CanvasNotFound />
  }

  // Use the (id) as a `key` so swapping to a different canvas remounts the
  // editor with a fresh `initialScene` snapshot.
  return <CanvasDetail key={canvas.id} canvas={canvas} />
}

// ---------------------------------------------------------------------------
// Not-found view
// ---------------------------------------------------------------------------

function CanvasNotFound() {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()
  return (
    <div
      data-testid="canvas-not-found"
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-12 text-center"
    >
      <p className="text-lg font-medium">{t('errors.canvasNotFound')}</p>
      <Button
        type="button"
        variant="outline"
        onClick={() => navigate({ to: route.canvas })}
      >
        {t('toolbar.backToList')}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail view (canvas guaranteed present)
// ---------------------------------------------------------------------------

interface CanvasDetailProps {
  canvas: Canvas
}

function CanvasDetail({ canvas }: CanvasDetailProps) {
  const { t } = useTranslation('canvas')
  const navigate = useNavigate()

  const theme = useExcalidrawTheme()

  // Snapshot the scene exactly once for Excalidraw's `initialData`. We do NOT
  // recompute this on re-render — the imperative API + auto-save own the
  // editor's mutable state from here on.
  const initialScene = useMemo<CanvasEditorInitialScene>(
    () => ({
      elements: canvas.elements,
      appState: canvas.appState as Record<string, unknown>,
      files: canvas.files as Record<string, unknown>,
    }),
    // Hydrate once per canvas id — snapshotting on later re-renders would
    // force-reseed the editor with stale data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas.id],
  )

  // Keep the imperative API for future use (theme sync, scene replacement
  // after import). Stored in a ref so re-renders don't churn it.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api
  }, [])

  // Ref that mirrors the orchestrator's manual-edit lock state. Used by
  // useCanvasAutoSave to skip debounced writes during a batch; flushOnce is
  // called on lock release to persist exactly one save after the batch.
  const isLockedRef = useRef<boolean>(false)

  // Auto-save: the hook owns the debounce + status machine. We pull `flush`
  // out for the Ctrl/Cmd+S manual-save shortcut so users can force a write
  // without waiting for the debounce window.
  const { onChange, saveStatus, flush, flushOnce } = useCanvasAutoSave({
    canvasId: canvas.id,
    isLockedRef,
    onSaveError: (err) => {
      // Translate the i18n key the lib layer uses to a real toast.
      toast.error(t('errors.saveFailed'), {
        description: err.message,
      })
    },
  })

  // ---- Dialog state -------------------------------------------------------

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(canvas.name)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ---- Action busy flag ---------------------------------------------------
  // While an export or copy is in flight we disable toolbar actions so the
  // user can't double-fire a long-running render.
  const [busy, setBusy] = useState(false)

  // ---- AI prompt-bar wiring (T20) ----------------------------------------
  // The Settings > MCP > excalidraw toggle gates whether the prompt bar +
  // indicator + lock banner mount at all. We read it via a fine-grained
  // selector so unrelated MCP toggles don't cause re-renders.
  const isExcalidrawActive = useMCPServers((s) =>
    Boolean(s.mcpServers['excalidraw']?.active),
  )

  // ---- Orchestrator deps (T1) ---------------------------------------------

  // TanStack Router instance for resolveActiveCanvas. Stable ref — the router
  // object does not change across renders.
  const router = useRouter()

  // serviceHub.mcp() returns MCPService whose callTool signature is:
  //   callTool({ toolName, serverName?, arguments }) => Promise<MCPToolCallResult>
  // McpClientLike expects:
  //   callTool(call: { name, arguments }) => Promise<McpToolResult>
  // Thin adapter bridges the two without touching the orchestrator contract.
  const serviceHub = useServiceHub()
  const mcpClient = useMemo(
    () => ({
      callTool: (call: McpToolCall): Promise<McpToolResult> => {
        // Sanitize arrow element fields: mcp_excalidraw Zod schema requires
        // non-null strings for endArrowhead/startArrowhead. LLMs often emit
        // null for these — replace with 'arrow' (the mcp_excalidraw default).
        let args = call.arguments
        if (
          (call.name === 'batch_create_elements' || call.name === 'create_element') &&
          args
        ) {
          const sanitizeEl = (el: Record<string, unknown>) => {
            const out = { ...el }
            if ('endArrowhead' in out && out.endArrowhead === null) out.endArrowhead = 'arrow'
            if ('startArrowhead' in out && out.startArrowhead === null) out.startArrowhead = 'none'
            return out
          }
          if (call.name === 'batch_create_elements' && Array.isArray(args.elements)) {
            args = { ...args, elements: args.elements.map(sanitizeEl) }
          } else if (call.name === 'create_element') {
            args = sanitizeEl(args as Record<string, unknown>) as typeof args
          }
        }
        return serviceHub
          .mcp()
          .callTool({ toolName: call.name, arguments: args })
          .then((result) => result as McpToolResult)
      },
    }),
    // serviceHub identity is stable (zustand singleton); safe to dep on it.
    [serviceHub],
  )

  // Per-route orchestrator instance. Memoised on `canvas.id` so swapping to a
  // different canvas yields a fresh orchestrator (mirrors how `<CanvasDetail
  // key={canvas.id} />` remounts the editor with a fresh `initialScene`).
  //
  // excalidrawAPI is intentionally omitted here — the Excalidraw imperative
  // API is only available after <CanvasEditor> mounts (async). We wire it in
  // the effect below via orchestrator.setThreadId-pattern analogue: the batch
  // controller is fail-closed when excalidrawAPI is absent, so first-render
  // is always safe. When the API arrives we update it on the orchestrator via
  // the setExcalidrawAPI effect.
  const orchestrator = useMemo(
    () =>
      new CanvasMcpOrchestrator({
        canvasStore: useCanvasStore,
        mcpClient,
        router,
        threadId: undefined,
        logger: console,
      }),
    // Recreate only when the canvas changes (new canvas = new orchestrator
    // session) or when the mcpClient wrapper identity changes (serviceHub
    // swap, which is practically never). Router is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas.id, mcpClient],
  )

  // Wire the Excalidraw imperative API into the orchestrator once it is
  // available. The batch controller reads excalidrawAPI only at batch-begin
  // time, so a post-mount update is safe. We store it on deps so the batch
  // controller has a live reference for T17 undo-grouping.
  useEffect(() => {
    const api = apiRef.current
    if (api) {
      // The deps bag is readonly but excalidrawAPI is typed `unknown` so we
      // can patch it without violating the orchestrator's public contract.
      // This is the documented late-binding path: deps.excalidrawAPI is read
      // lazily inside the batch controller's begin/end methods (T17), not at
      // construction time.
      ;(
        orchestrator as unknown as {
          deps: { excalidrawAPI: unknown }
        }
      ).deps.excalidrawAPI = api
    }
  })
  // Intentionally no deps array — runs after every render so apiRef.current
  // is always reflected on the orchestrator once Excalidraw has mounted.

  // The orchestrator class deliberately does not expose `OrchestratorState`
  // as observable internal state — the route owns the FSM cursor and walks
  // it manually around `beginAiBatch` / `endAiBatch`.
  const [orchestratorState, setOrchestratorState] =
    useState<OrchestratorState>('idle')

  // Manual-edit lock state, sourced from the orchestrator's lock controller.
  // The subscription fires on every refCount change; we only care about the
  // boolean derived from `isManualEditLocked()`.
  const [isManualEditLocked, setIsManualEditLocked] = useState<boolean>(
    () => orchestrator.isManualEditLocked(),
  )
  useEffect(() => {
    // Sync once on mount in case lock state changed before subscription.
    setIsManualEditLocked(orchestrator.isManualEditLocked())
    const unsubscribe = orchestrator.subscribeManualEditLock((locked) => {
      setIsManualEditLocked(orchestrator.isManualEditLocked())
      // Keep the ref in sync so useCanvasAutoSave can skip writes during batch.
      isLockedRef.current = locked
      // When the lock releases, flush the last pending scene exactly once.
      if (!locked) flushOnce()
    })
    return () => {
      unsubscribe()
    }
  }, [orchestrator, flushOnce])

  // ---- AI dispatch state (T6) ---------------------------------------------

  // Progress counter shown in CanvasAiIndicator: { current, total }.
  const [progress, setProgress] = useState<{ current: number; total: number } | undefined>(
    undefined,
  )

  // Last error seen during a batch — surfaces for T9 error banner.
  const [lastBatchError, setLastBatchError] = useState<Error | null>(null)

  // T9: structured error state for the banner — includes retryFromIndex so
  // the retry handler knows which tool to resume from.
  const [errorState, setErrorState] = useState<{
    message: string
    canRetry: boolean
    retryFromIndex: number
  } | null>(null)

  // AbortController for the in-flight dispatch loop. Replaced on each new
  // submit; handleStop aborts it to halt the loop mid-flight.
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Deferred-collect buffer: tool calls streamed from the LLM are pushed
  // here by onToolCall; the dispatch loop in onFinish drains it.
  const sessionData = useRef<{ tools: McpToolCall[] }>({ tools: [] })

  // Batch lifecycle refs — set by handlePromptSubmit, consumed by onFinish so
  // the finally block always cleans up regardless of where the error occurs.
  const batchTokenRef = useRef<ReturnType<typeof orchestrator.beginAiBatch> | null>(null)
  const unlockRef = useRef<(() => void) | null>(null)

  // ---- T11: selectedModel local state ------------------------------------
  // Reads the global default once on mount; local state from then on.
  // V1: no persistence — selection is reset when the route unmounts.
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(
    () => {
      const global = useModelProvider.getState().selectedModel
      if (!global) return null
      // Map the global Model type to the local ModelInfo shape.
      // useModelProvider.selectedModel has id, name; selectedProvider gives provider.
      const provider = useModelProvider.getState().selectedProvider
      return {
        id: global.id,
        name: (global as { displayName?: string; name?: string }).displayName
          ?? (global as { name?: string }).name
          ?? global.id,
        provider,
      }
    }
  )

  // ---- useCanvasChat wiring (T2 → T6) ------------------------------------

  // Stable ref for addToolOutput — populated after useCanvasChat returns.
  // onToolCall is defined before useCanvasChat, so it captures this ref and
  // calls through it once addToolOutput is available (same pattern as onToolCallRef).
  const addToolOutputRef = useRef<((output: ToolOutput) => void) | null>(null)

  // onToolCall: immediately dispatch each tool call as it arrives from the LLM,
  // then feed the result back via addToolOutput so the LLM can continue to
  // the next tool in the same streaming turn.
  const onToolCall = useCallback(async (call: McpToolCall) => {
    console.log('[CANVAS] onToolCall fired:', call)
    // Keep a record for handleRetry (retry still iterates sessionData.tools).
    sessionData.current.tools.push(call)

    const signal = toolCallAbortController.current?.signal
    if (signal?.aborted) return

    const toolCallId = call.toolCallId ?? ''

    try {
      const result: McpToolResult = await orchestrator.dispatchToolCall(call)
      console.log('[CANVAS] dispatchToolCall result for', call.name, ':', result)
      await applyMutationsToCanvas(result, orchestrator, { signal })
      console.log('[CANVAS] applyMutationsToCanvas done for', call.name)

      // Feed result back to the LLM so it can continue the turn.
      const outputText =
        'content' in result
          ? result.content.map((c) => c.text).join('\n')
          : `Error: ${result.error}`
      addToolOutputRef.current?.({
        state: 'output',
        tool: call.name,
        toolCallId,
        output: outputText,
      })

      setProgress((prev) => ({
        current: (prev?.current ?? 0) + 1,
        total: sessionData.current.tools.length,
      }))
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.error('[CANVAS] dispatch error in onToolCall:', error.message, error)

      addToolOutputRef.current?.({
        state: 'output-error',
        tool: call.name,
        toolCallId,
        errorText: error.message,
      })

      setOrchestratorState('error')
      setLastBatchError(error)
      setErrorState({
        message: error.message,
        canRetry: true,
        retryFromIndex: sessionData.current.tools.length - 1,
      })
      toast.error(t('errors.aiPromptFailed', { defaultValue: 'AI prompt failed' }), {
        description: error.message,
      })
    }
  }, [orchestrator, t])

  // onFinish: runs AFTER the LLM stream ends. All tool dispatches have already
  // completed in onToolCall — this only handles batch lifecycle cleanup.
  const onFinish = useCallback(() => {
    console.log('[CANVAS] onFinish fired — cleaning up batch lifecycle')
    const batchToken = batchTokenRef.current
    const unlock = unlockRef.current

    try { unlock?.() } catch { /* idempotent */ }
    if (batchToken !== null) {
      try { orchestrator.endAiBatch(batchToken) } catch { /* fail-closed */ }
    }
    orchestrator.clearBatchApproval()
    setOrchestratorState((prev) => (prev === 'error' ? 'error' : 'idle'))
    batchTokenRef.current = null
    unlockRef.current = null
  }, [orchestrator])

  const { sendMessage, stop, addToolOutput } = useCanvasChat({
    canvasId: canvas.id,
    model: (selectedModel ?? { id: 'poolprox/auto', name: 'Auto' }) as never,
    provider: selectedModel?.provider ?? 'auto',
    onToolCall,
    onFinish,
  })
  // Wire the stable ref so onToolCall can call addToolOutput without it being
  // in the callback's dep array (addToolOutput is stable from useChatSDK).
  addToolOutputRef.current = addToolOutput

  // ---- Submit handler (T6) ------------------------------------------------

  // handlePromptSubmit — pre-flight + fire.
  //
  // Responsibilities:
  //   1. Count mutating/readonly tools → requestBatchApproval
  //   2. cancel → return (no LLM call)
  //   3. approve-all → setBatchApproval(token)
  //   4. spawning state → beginAiBatch → lockManualEdits
  //   5. Store batch token + unlock fn into refs for onFinish to consume
  //   6. Fire sendMessage (async; onFinish owns cleanup)
  //
  // onFinish owns: dispatch loop, error state, endAiBatch, clearBatchApproval,
  // unlock, idle state reset — always runs in its own try/finally.
  const handlePromptSubmit = useCallback(
    async (prompt: string) => {
      console.log('[CANVAS] handlePromptSubmit fired with prompt:', prompt)
      // Step 1: Count tools for the approval preview.
      const mutating = EXCALIDRAW_MUTATING_TOOLS.size
      const readonly = EXCALIDRAW_READONLY_TOOLS.size

      // Step 2: Request bulk-batch approval before touching the LLM.
      const choice = await useToolApproval
        .getState()
        .requestBatchApproval(canvas.id, { mutating, readonly })

      // Step 3: User cancelled — return without starting anything.
      if (choice === 'cancel') {
        return
      }

      // Step 4: approve-all → set batch approval token.
      if (choice === 'approve-all') {
        orchestrator.setBatchApproval(createBatchApprovalToken())
      }

      // Step 5: Begin batch session and store refs for onFinish.
      setOrchestratorState('spawning')
      batchTokenRef.current = orchestrator.beginAiBatch()
      unlockRef.current = orchestrator.lockManualEdits()

      // Step 6: Reset per-session state.
      toolCallAbortController.current = new AbortController()
      sessionData.current = { tools: [] }
      setProgress(undefined)
      setLastBatchError(null)
      setOrchestratorState('drawing')

      // Step 7: Fire — onFinish will dispatch tools and clean up.
      sendMessage(prompt)
      console.log('[CANVAS] sendMessage called, waiting for LLM...')
    },
    [canvas.id, orchestrator, sendMessage],
  )

  // stop callback: abort in-flight loop + stop LLM stream.
  const handleStop = useCallback(() => {
    toolCallAbortController.current?.abort()
    stop()
  }, [stop])

  // ---- T9: Error banner callbacks -----------------------------------------

  // handleRetry: re-run dispatch loop from errorState.retryFromIndex over the
  // SAME sessionData.tools — no new LLM call. Clears errorState on start.
  const handleRetry = useCallback(async () => {
    if (!errorState) return

    const tools = sessionData.current.tools
    const retryFrom = errorState.retryFromIndex

    // Clear banner immediately so user sees feedback.
    setErrorState(null)
    setOrchestratorState('drawing')

    // Fresh AbortController for the retry loop.
    toolCallAbortController.current = new AbortController()
    const signal = toolCallAbortController.current.signal

    try {
      for (let i = retryFrom; i < tools.length; i++) {
        if (signal.aborted) break

        const call = tools[i]
        const result: McpToolResult = await orchestrator.dispatchToolCall(call)
        await applyMutationsToCanvas(result, orchestrator, { signal })

        setProgress({ current: i + 1, total: tools.length })
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setOrchestratorState('error')
      setLastBatchError(error)
      setErrorState({
        message: error.message,
        canRetry: true,
        retryFromIndex: retryFrom,
      })
      toast.error(t('errors.aiPromptFailed', { defaultValue: 'AI prompt failed' }), {
        description: error.message,
      })
    } finally {
      setOrchestratorState((prev) => (prev === 'error' ? 'error' : 'idle'))
    }
  }, [errorState, orchestrator, t])

  // handleDismissError: clear the error banner and close the batch cleanly.
  // Partial elements drawn before the error are preserved.
  const handleDismissError = useCallback(() => {
    setErrorState(null)
    // Close batch lifecycle cleanly — mirrors the finally block in onFinish.
    const batchToken = batchTokenRef.current
    const unlock = unlockRef.current
    try { unlock?.() } catch { /* idempotent */ }
    if (batchToken !== null) {
      try { orchestrator.endAiBatch(batchToken) } catch { /* fail-closed */ }
    }
    orchestrator.clearBatchApproval()
    batchTokenRef.current = null
    unlockRef.current = null
    setOrchestratorState('idle')
  }, [orchestrator])

  // ---- Live scene reader --------------------------------------------------
  /**
   * Read the freshest scene — the auto-save hook may not have flushed yet,
   * so we prefer the imperative API (which always reflects the current
   * editor state). Falls back to the persisted record.
   */
  const readLiveScene = useCallback((): CanvasScene => {
    const api = apiRef.current
    if (api) {
      return {
        elements: api.getSceneElements(),
        appState: api.getAppState(),
        files: api.getFiles(),
      }
    }
    return {
      elements: canvas.elements,
      appState: canvas.appState,
      files: canvas.files,
    }
  }, [canvas])

  // ---- Save helpers -------------------------------------------------------

  /**
   * Save a text payload (SVG / JSON / .excalidraw) — desktop uses Tauri's
   * native save dialog, web falls back to a synthetic anchor download.
   * Returns the picked path (desktop) or `null` (web fallback / cancel).
   */
  const saveText = useCallback(
    async (
      data: string,
      format: 'svg' | 'json' | 'excalidraw',
      filenameExt: string,
      mimeType: string,
    ): Promise<{ path: string | null; saved: boolean }> => {
      if (isFileIoAvailable()) {
        const path = await saveCanvasFile({
          defaultName: canvas.name,
          format,
          data,
        })
        return { path, saved: path !== null }
      }
      const blob = new Blob([data], { type: mimeType })
      downloadBlob(blob, `${canvas.name}.${filenameExt}`)
      return { path: null, saved: true }
    },
    [canvas.name],
  )

  /**
   * Save a PNG blob — desktop's write_file_sync is UTF-8-only today, so PNG
   * always flows through the browser download path.
   */
  const savePng = useCallback(
    (blob: Blob): { path: string | null; saved: boolean } => {
      downloadBlob(blob, `${canvas.name}.png`)
      return { path: null, saved: true }
    },
    [canvas.name],
  )

  // ---- Toolbar dispatcher -------------------------------------------------

  const handleAction = useCallback(
    async (action: CanvasToolbarAction) => {
      switch (action) {
        case 'png': {
          setBusy(true)
          try {
            const blob = await exportCanvasToPng(readLiveScene())
            savePng(blob)
            toast.success(
              t('export.pngSuccess', { path: `${canvas.name}.png` }),
            )
          } catch (err) {
            toast.error(t('errors.exportPngFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'svg': {
          setBusy(true)
          try {
            const svg = await exportCanvasToSvg(readLiveScene())
            const result = await saveText(
              svg,
              'svg',
              'svg',
              'image/svg+xml',
            )
            if (result.saved) {
              toast.success(
                t('export.svgSuccess', {
                  path: result.path ?? `${canvas.name}.svg`,
                }),
              )
            }
          } catch (err) {
            toast.error(t('errors.exportSvgFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'json':
        case 'exportFile': {
          setBusy(true)
          try {
            // Build a Canvas-shaped payload from the live scene so the
            // serializer sees the freshest elements/appState.
            const live = readLiveScene()
            const json = exportCanvasToJson({
              ...canvas,
              elements: live.elements,
              appState: live.appState,
              files: live.files,
            })
            const ext = action === 'exportFile' ? 'excalidraw' : 'json'
            const result = await saveText(
              json,
              action === 'exportFile' ? 'excalidraw' : 'json',
              ext,
              'application/json',
            )
            if (result.saved) {
              toast.success(
                t('export.jsonSuccess', {
                  path: result.path ?? `${canvas.name}.${ext}`,
                }),
              )
            }
          } catch (err) {
            toast.error(t('errors.exportJsonFailed'), {
              description: err instanceof Error ? err.message : String(err),
            })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'importFile': {
          if (!isFileIoAvailable()) {
            toast.error(t('export.downloadDesktopOnly'))
            return
          }
          setBusy(true)
          try {
            const result = await openExcalidrawFile()
            if (!result) return // user cancelled
            const { canvas: imported } = result
            useCanvasStore.getState().update(canvas.id, {
              name: imported.name || canvas.name,
              elements: imported.elements as Canvas['elements'],
              appState: imported.appState,
              files: imported.files,
            })
            toast.success(t('import.successToast'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const key = msg.startsWith('errors.importParseError')
              ? 'errors.importParseError'
              : 'errors.importReadError'
            toast.error(t(key), { description: msg })
          } finally {
            setBusy(false)
          }
          return
        }

        case 'copy': {
          setBusy(true)
          try {
            await copyCanvasImageToClipboard(readLiveScene())
            toast.success(t('export.copyImageSuccess'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            const key =
              msg === 'errors.clipboardUnsupported'
                ? 'errors.clipboardUnsupported'
                : 'errors.clipboardFailed'
            toast.error(t(key))
          } finally {
            setBusy(false)
          }
          return
        }

        case 'rename': {
          setRenameValue(canvas.name)
          setRenameOpen(true)
          return
        }

        case 'duplicate': {
          const newId = useCanvasStore.getState().duplicate(canvas.id)
          if (newId) {
            toast.success(t('duplicate.successToast'))
            navigate({
              to: route.canvasDetail,
              params: { canvasId: newId },
            })
          }
          return
        }

        case 'delete': {
          setDeleteOpen(true)
          return
        }

        case 'back': {
          navigate({ to: route.canvas })
          return
        }
      }
    },
    [canvas, navigate, readLiveScene, savePng, saveText, t],
  )

  // ---- Keyboard shortcuts -------------------------------------------------
  //
  // Detail-view shortcuts. The shared `useKeyboardShortcut` hook fires on the
  // window and calls `e.preventDefault()` whenever the combo matches, so it
  // safely supersedes the browser's native Ctrl/Cmd+S save dialog.
  //
  // Excalidraw's own keyboard model:
  //   - Undo/redo, copy/paste, delete, arrow-nudge, zoom: handled by Excalidraw.
  //   - The hotkeys we register here (Ctrl/Cmd+S, Ctrl/Cmd+Shift+E, Ctrl/Cmd+I,
  //     Esc) are *not* Excalidraw-owned scene shortcuts, so intercepting them
  //     at the window level is non-disruptive — except while the user is
  //     editing text inside the canvas (Excalidraw mounts a real <textarea>
  //     for text tools). In that case we let the keystroke fall through.

  // Ctrl/Cmd+S → flush any pending auto-save write immediately.
  useKeyboardShortcut({
    key: 's',
    usePlatformMetaKey: true,
    callback: () => {
      flush()
      toast.success(t('shortcuts.savedToast'))
    },
  })

  // Ctrl/Cmd+Shift+E → quick-export current scene as PNG (matches the
  // toolbar's PNG action).
  useKeyboardShortcut({
    key: 'e',
    usePlatformMetaKey: true,
    shiftKey: true,
    callback: () => {
      void handleAction('png')
    },
  })

  // Esc has two behaviours depending on whether a batch is in flight:
  //
  //   1. Batch active (orchestratorState !== 'idle'):
  //      Abort the in-flight dispatch loop + stop the LLM stream.
  //      stopPropagation() so the event does NOT reach Excalidraw or the
  //      navigation branch below.
  //      We do NOT call preventDefault() here — Esc should still close any
  //      open Excalidraw tool popover if focus is inside the editor, but
  //      that case is already guarded by the input/excalidraw checks below.
  //
  //   2. Batch idle:
  //      Original behaviour — navigate back to the canvas list, unless focus
  //      is inside an editable element or the Excalidraw editor itself.
  //
  // Plain `window` listener (not useKeyboardShortcut) because:
  //   a. useKeyboardShortcut always calls preventDefault(), which would swallow
  //      Esc keystrokes Excalidraw uses to deselect tools / exit edit mode.
  //   b. We need target-aware logic to bail when the active element is inside
  //      the editor or any input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return

      const target = e.target as HTMLElement | null
      const active = document.activeElement as HTMLElement | null

      // Skip when the target is a native input — let the browser / Excalidraw
      // handle Esc natively (close picker, deselect, etc.).
      const isNativeInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement

      if (isNativeInput) return

      // If a batch is in flight: abort it and stop propagation so the
      // navigation branch below is never reached.
      if (orchestratorState !== 'idle') {
        handleStop()
        e.stopPropagation()
        return
      }

      // Idle path — navigate back unless focus is inside an editable or
      // inside Excalidraw (where its own Esc binding should take over).
      const editable =
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      if (editable) return

      // Skip when focus is inside Excalidraw — its own Esc binding handles
      // tool deselect / edit-mode exit.
      if (target?.closest?.('.excalidraw')) return
      if (active?.closest?.('.excalidraw')) return

      e.preventDefault()
      navigate({ to: route.canvas })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, orchestratorState, handleStop])

  // ---- Rename submit ------------------------------------------------------

  const submitRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === canvas.name) {
      setRenameOpen(false)
      return
    }
    try {
      useCanvasStore.getState().rename(canvas.id, trimmed)
      setRenameOpen(false)
    } catch (err) {
      toast.error(t('errors.renameFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [canvas.id, canvas.name, renameValue, t])

  // ---- Delete confirm -----------------------------------------------------

  const confirmDelete = useCallback(() => {
    try {
      useCanvasStore.getState().delete(canvas.id)
      setDeleteOpen(false)
      navigate({ to: route.canvas })
    } catch (err) {
      toast.error(t('errors.deleteFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [canvas.id, navigate, t])

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex h-full w-full flex-col">
      <CanvasToolbar
        canvasName={canvas.name}
        saveStatus={saveStatus}
        onAction={handleAction}
        busy={busy}
      />
      <div className="relative flex-1 min-h-0">
        <CanvasEditor
          initialScene={initialScene}
          theme={theme}
          onChange={onChange}
          onApiReady={handleApiReady}
          viewModeEnabled={isManualEditLocked}
          className="h-full w-full"
        />
        {isExcalidrawActive && (
          <>
            <CanvasAiIndicator state={orchestratorState} progress={progress} />
            <CanvasManualEditLockBanner isLocked={isManualEditLocked} />
          </>
        )}
        {errorState !== null && (
          <CanvasErrorBanner
            error={errorState}
            onRetry={handleRetry}
            onDismiss={handleDismissError}
          />
        )}
      </div>
      {isExcalidrawActive && (
        <CanvasPromptBar
          canvasId={canvas.id}
          isSubmitting={orchestratorState !== 'idle'}
          onSubmit={handlePromptSubmit}
          onStop={handleStop}
          modelPicker={
            <CanvasModelPicker
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              disabled={orchestratorState !== 'idle'}
            />
          }
        />
      )}

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rename.dialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label
              htmlFor="canvas-rename-input"
              className="text-sm font-medium"
            >
              {t('rename.label')}
            </label>
            <Input
              id="canvas-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t('rename.placeholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRenameOpen(false)}
            >
              {t('rename.cancel')}
            </Button>
            <Button type="button" onClick={submitRename}>
              {t('rename.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('delete.confirm', { name: canvas.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(false)}
            >
              {t('delete.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
            >
              {t('delete.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
