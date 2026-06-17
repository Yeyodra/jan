import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route as McpServersRoute } from '../mcp-servers'

const activateMCPServer = vi.fn()
const deactivateMCPServer = vi.fn()
const getConnectedServers = vi.fn().mockResolvedValue([])

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/Card', () => ({
  Card: ({
    header,
    children,
  }: {
    header?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid="card">
      {header}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    description,
    descriptionOutside,
    actions,
  }: {
    title?: React.ReactNode
    description?: React.ReactNode
    descriptionOutside?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      <div>{title}</div>
      <div>{description}</div>
      <div>{descriptionOutside}</div>
      <div>{actions}</div>
    </div>
  ),
}))

vi.mock('@/containers/dialogs/AddEditMCPServer', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/DeleteMCPServerConfirm', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/EditJsonMCPserver', () => ({
  default: () => null,
}))

vi.mock('@/containers/McpRouterModelPicker', () => ({
  McpRouterModelPicker: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked?: boolean
    onCheckedChange?: (value: boolean) => void
    disabled?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checked}
      onClick={() => onCheckedChange?.(!checked)}
    >
      toggle
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    mcp: () => ({
      activateMCPServer,
      deactivateMCPServer,
      getConnectedServers,
    }),
  }),
}))

vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: () => ({
    allowAllMCPPermissions: true,
    setAllowAllMCPPermissions: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (state: { providers: never[] }) => unknown) =>
    selector({ providers: [] }),
}))

const mcpServersFixture = {
  excalidraw: {
    command: 'bun',
    args: ['resources/mcp_excalidraw/dist/index.js'],
    env: { ENABLE_CANVAS_SYNC: 'false' },
    type: 'stdio',
    active: false,
    official: true,
  },
  'Jan Browser MCP': {
    command: 'npx',
    args: ['-y', 'search-mcp-server@latest'],
    env: { BRIDGE_HOST: '127.0.0.1', BRIDGE_PORT: '17389' },
    type: 'stdio',
    active: false,
    official: true,
  },
  fetch: {
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {},
    type: 'stdio',
    active: false,
  },
}

vi.mock('@/hooks/useMCPServers', () => ({
  DEFAULT_MCP_SETTINGS: {
    toolCallTimeoutSeconds: 60,
    enableSmartToolRouting: false,
    useLightweightRouterModel: false,
    routerModelProvider: '',
    routerModelId: '',
  },
  useMCPServers: () => ({
    mcpServers: mcpServersFixture,
    settings: {
      toolCallTimeoutSeconds: 60,
      enableSmartToolRouting: false,
      useLightweightRouterModel: false,
      routerModelProvider: '',
      routerModelId: '',
    },
    addServer: vi.fn(),
    editServer: vi.fn(),
    renameServer: vi.fn(),
    deleteServer: vi.fn(),
    syncServers: vi.fn(),
    syncServersAndRestart: vi.fn(),
    getServerConfig: (key: string) =>
      (mcpServersFixture as Record<string, unknown>)[key],
    setSettings: vi.fn(),
    updateSettings: vi.fn(),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.serverKey ? `${key}:${params.serverKey}` : key,
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('@/types/events', () => ({
  SystemEvent: {
    MCP_UPDATE: 'mcp-update',
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (config: { component: React.ComponentType }) =>
    config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      mcp_servers: '/settings/mcp-servers',
    },
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('mcp-servers settings: official badge + scoped notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getConnectedServers.mockResolvedValue([])
  })

  it('renders an "Official" badge for entries with official: true', () => {
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)

    // Badge text appears at least twice (excalidraw + Jan Browser MCP).
    const badges = screen.getAllByText('Official')
    expect(badges.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT render the Jan Browser Extension note for excalidraw (official but not Jan Browser MCP)', () => {
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)

    // The Install Extension link is the unique signal of the Jan Browser MCP note.
    // It must appear exactly once (for "Jan Browser MCP" only), not for excalidraw.
    const installLinks = screen.getAllByText(/Install Extension/i)
    expect(installLinks).toHaveLength(1)
  })

  it('renders the Jan Browser Extension note ONLY for the Jan Browser MCP entry', () => {
    const Component = McpServersRoute.component as React.ComponentType
    render(<Component />)

    const installLink = screen.getByRole('link', { name: /Install Extension/i })
    expect(installLink).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/jan-browser-mcp/mkciifcjehgnpaigoiaakdgabbpfppal'
    )
  })
})
