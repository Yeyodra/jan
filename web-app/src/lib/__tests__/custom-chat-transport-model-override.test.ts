/**
 * Regression test for the Compare-feature "wrong-model dispatch" bug
 * (`bug-codebuddy-400.md`). When `CustomChatTransport` is constructed with a
 * `modelOverride`, `sendMessages` MUST resolve the model from that override
 * — NOT from `useModelProvider`'s global singleton.
 *
 * Strategy: mock `streamText` and `ModelFactory.createModel` to capture the
 * args they receive, then call `sendMessages` once with override set and once
 * without, asserting which provider+model was used in each case.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Hoisted mock state — `useModelProvider` returns these values.
const globalSelection = vi.hoisted(() => ({
  selectedProvider: 'openai',
  selectedModel: { id: 'gpt-4o' } as { id: string } | null,
  providers: {} as Record<string, unknown>,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: { getState: () => ({ serviceHub: {} }) },
}))

vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({
      getDisabledToolsForThread: () => [],
      getDefaultDisabledTools: () => [],
    }),
  },
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: globalSelection.selectedModel,
      selectedProvider: globalSelection.selectedProvider,
      getProviderByName: (name: string) =>
        globalSelection.providers[name] ?? null,
    }),
  },
}))

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ threads: {} }) },
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: { getState: () => ({ enabled: false }) },
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => ({ settings: {} }) },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({
      setCurrentStreamThreadId: vi.fn(),
      updateLoadingModel: vi.fn(),
      updateThreadLoadingModel: vi.fn(),
      updatePromptProgress: vi.fn(),
      updateThreadPromptProgress: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: { getInstance: () => ({ get: () => null }) },
}))

vi.mock('@/lib/mcp-orchestrator', () => ({
  mcpOrchestrator: { getRelevantTools: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/lib/mcp-router-model-filter', () => ({
  isRouterModelSelectable: () => false,
}))

const createModel = vi.fn()
vi.mock('../model-factory', () => ({
  ModelFactory: {
    createModel: (...args: unknown[]) => createModel(...args),
  },
}))

const streamTextSpy = vi.fn()
vi.mock('ai', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => {
      streamTextSpy(...args)
      return {
        toUIMessageStream: () => new ReadableStream(),
      }
    },
    convertToModelMessages: (m: unknown) => m,
  }
})

// Import AFTER mocks.
import { CustomChatTransport } from '../custom-chat-transport'

function makeProvider(name: string, modelId: string): ModelProvider {
  return {
    active: true,
    provider: name,
    api_key: 'sk-test',
    base_url: 'https://example.test',
    settings: [],
    models: [{ id: modelId }],
  } as unknown as ModelProvider
}

describe('CustomChatTransport modelOverride (Bug A regression)', () => {
  beforeEach(() => {
    createModel.mockReset()
    streamTextSpy.mockReset()
    createModel.mockResolvedValue({ id: 'mock-model' })
    globalSelection.selectedProvider = 'openai'
    globalSelection.selectedModel = { id: 'gpt-4o' }
    globalSelection.providers = {
      openai: makeProvider('openai', 'gpt-4o'),
    }
  })

  it('uses modelOverride when set, ignoring global useModelProvider selection', async () => {
    const overrideProvider = makeProvider('codebuddy', 'cb-opus-4.7-1m')
    const transport = new CustomChatTransport(undefined, 'compare:abc', {
      modelOverride: { provider: overrideProvider, modelId: 'cb-opus-4.7-1m' },
    })

    await transport.sendMessages({
      chatId: 'compare:abc',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    // Model resolution must use override, NOT global ("openai"/"gpt-4o").
    expect(createModel).toHaveBeenCalled()
    const [modelIdArg, providerArg] = createModel.mock.calls[0]
    expect(modelIdArg).toBe('cb-opus-4.7-1m')
    expect((providerArg as ModelProvider).provider).toBe('codebuddy')
  })

  it('falls back to global useModelProvider selection when no override', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-x')

    await transport.sendMessages({
      chatId: 'thread-x',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    const [modelIdArg, providerArg] = createModel.mock.calls[0]
    expect(modelIdArg).toBe('gpt-4o')
    expect((providerArg as ModelProvider).provider).toBe('openai')
  })

  it('forwards maxRetries to streamText when set (Bug B regression)', async () => {
    const overrideProvider = makeProvider('codebuddy', 'cb-opus-4.7-1m')
    const transport = new CustomChatTransport(undefined, 'compare:abc', {
      modelOverride: { provider: overrideProvider, modelId: 'cb-opus-4.7-1m' },
      maxRetries: 0,
    })

    await transport.sendMessages({
      chatId: 'compare:abc',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    expect(streamTextSpy).toHaveBeenCalledTimes(1)
    const streamArg = streamTextSpy.mock.calls[0][0]
    expect(streamArg.maxRetries).toBe(0)
  })

  it('omits maxRetries from streamText when not set (preserves SDK default for legacy callers)', async () => {
    const transport = new CustomChatTransport(undefined, 'thread-x')

    await transport.sendMessages({
      chatId: 'thread-x',
      messages: [
        { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    const streamArg = streamTextSpy.mock.calls[0][0]
    expect('maxRetries' in streamArg).toBe(false)
  })

  it('forceSendAllParts: true preserves image parts even when model lacks vision capability (Compare bypass)', async () => {
    // Global selection has no `capabilities` array → vision treated as false.
    const overrideProvider = makeProvider('codebuddy', 'cb-text-only')
    const transport = new CustomChatTransport(undefined, 'compare:abc', {
      modelOverride: { provider: overrideProvider, modelId: 'cb-text-only' },
      forceSendAllParts: true,
    })

    await transport.sendMessages({
      chatId: 'compare:abc',
      messages: [
        {
          id: '1',
          role: 'user',
          parts: [
            { type: 'text', text: 'describe this' },
            {
              type: 'file',
              mediaType: 'image/png',
              url: 'data:image/png;base64,AAA',
            },
          ],
        },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    expect(streamTextSpy).toHaveBeenCalledTimes(1)
    const streamArg = streamTextSpy.mock.calls[0][0]
    const userMsg = streamArg.messages.find(
      (m: { role: string }) => m.role === 'user'
    )
    const hasImage = userMsg?.parts?.some(
      (p: { type?: string; mediaType?: string }) =>
        p.type === 'image' ||
        (p.type === 'file' && p.mediaType?.startsWith('image/'))
    )
    expect(hasImage).toBe(true)
  })

  it('forceSendAllParts undefined (legacy) strips image parts when model lacks vision', async () => {
    // No forceSendAllParts → existing strip behavior applies.
    const overrideProvider = makeProvider('codebuddy', 'cb-text-only')
    const transport = new CustomChatTransport(undefined, 'thread-x', {
      modelOverride: { provider: overrideProvider, modelId: 'cb-text-only' },
    })

    await transport.sendMessages({
      chatId: 'thread-x',
      messages: [
        {
          id: '1',
          role: 'user',
          parts: [
            { type: 'text', text: 'describe this' },
            {
              type: 'file',
              mediaType: 'image/png',
              url: 'data:image/png;base64,AAA',
            },
          ],
        },
      ] as never,
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: undefined,
    })

    const streamArg = streamTextSpy.mock.calls[0][0]
    const userMsg = streamArg.messages.find(
      (m: { role: string }) => m.role === 'user'
    )
    const hasImage = userMsg?.parts?.some(
      (p: { type?: string; mediaType?: string }) =>
        p.type === 'image' ||
        (p.type === 'file' && p.mediaType?.startsWith('image/'))
    )
    expect(hasImage).toBe(false)
  })
})
