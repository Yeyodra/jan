import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@janhq/core'
import { MCPTool } from '@/types/completion'
import { canvasBuiltinTools } from '@/lib/canvas/ai-tools'

/**
 * Project the in-process canvas built-in tools (T18) into the MCPTool surface
 * the rest of the app already knows how to render, gate, and dispatch.
 *
 * The canvas tools carry an extra `handler` field that the MCPTool registry
 * doesn't model — we strip it here so the registry stays a pure data view.
 * The dispatcher (T21+) re-resolves the handler by name from
 * `canvasBuiltinToolsByName` when a tool call arrives, so nothing is lost.
 */
const canvasToolsAsMCP: MCPTool[] = canvasBuiltinTools.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
  server: t.server,
}))

export const useTools = () => {
  const updateTools = useAppState((state) => state.updateTools)
  const updateRagToolNames = useAppState((state) => state.updateRagToolNames)
  const updateMcpToolNames = useAppState((state) => state.updateMcpToolNames)
  const updateCanvasToolNames = useAppState(
    (state) => state.updateCanvasToolNames
  )
  const { isDefaultsInitialized, setDefaultDisabledTools, markDefaultsAsInitialized } = useToolAvailable()

  useEffect(() => {
    async function setTools() {
      try {
        // Get MCP extension first
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        // Fetch tools and tool names in parallel.
        // Canvas built-ins are static/in-process, so they resolve immediately;
        // wrapping them in Promise.resolve keeps the parallel shape uniform.
        const [mcpTools, ragToolNames, canvasTools] = await Promise.all([
          getServiceHub().mcp().getTools(),
          getServiceHub().rag().getToolNames?.() ?? Promise.resolve([]),
          Promise.resolve(canvasToolsAsMCP),
        ])

        const mcpNames = mcpTools.map((t) => t.name)
        const mcpNameSet = new Set(mcpNames)

        // Defensive shadow check: if a remote MCP server ever publishes a
        // `canvas_*` name, MCP wins (it was fetched from a real server) and
        // we drop our built-in to avoid two tools answering to the same name.
        const canvasNotShadowed = canvasTools.filter(
          (t) => !mcpNameSet.has(t.name)
        )
        if (canvasNotShadowed.length !== canvasTools.length) {
          const shadowed = canvasTools
            .filter((t) => mcpNameSet.has(t.name))
            .map((t) => t.name)
          console.warn(
            `[tools] Canvas built-in tool(s) shadowed by MCP: ${shadowed.join(', ')}`
          )
        }

        // Merge canvas tools into the registry. They share the MCPTool shape
        // and `server: 'canvas'` namespacing so the dropdown, approval flow,
        // and per-thread enable/disable logic all treat them uniformly.
        const mergedTools: MCPTool[] = [...mcpTools, ...canvasNotShadowed]
        updateTools(mergedTools)

        const ragOnly = ragToolNames.filter((n) => !mcpNameSet.has(n))
        if (ragOnly.length !== ragToolNames.length) {
          const shadowed = ragToolNames.filter((n) => mcpNameSet.has(n))
          console.warn(
            `[tools] RAG tool(s) shadowed by MCP and routed to MCP: ${shadowed.join(', ')}`
          )
        }
        updateMcpToolNames(mcpNames)
        updateRagToolNames(ragOnly)
        updateCanvasToolNames(canvasNotShadowed.map((t) => t.name))

        // Initialize default disabled tools for new users (only once)
        if (!isDefaultsInitialized() && mcpTools.length > 0 && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDefaultDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        console.error('Failed to fetch MCP tools:', error)
      }
    }
    setTools()

    let unsubscribe = () => {}
    getServiceHub().events().listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      unsubscribe = unsub
    }).catch((error) => {
      console.error('Failed to set up MCP update listener:', error)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
