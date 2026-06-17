# Task 21 — Verification: Settings > MCP toggle wire-up + "(built-in)" label

**Wave**: 5 (Settings & UI integration)
**Plan reference**: `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` (line 2095)
**Branch**: `feat/excalidraw-mcp`
**Date**: 2026-06-17

---

## 1. `excalidraw` exists in `DEFAULT_MCP_CONFIG` with `official: true, active: false`

**File**: `src-tauri/src/core/mcp/constants.rs`
**Lines**: 61-67

```rust
"excalidraw": {
  "command": "bun",
  "args": ["resources/mcp_excalidraw/dist/index.js"],
  "env": { "ENABLE_CANVAS_SYNC": "false" },
  "active": false,
  "official": true
}
```

→ Invariant satisfied: registered as built-in, disabled by default.
→ Snapshot persisted in `.sisyphus/evidence/task-21-config-snapshot.json`.

(Note: `DEFAULT_MCP_CONFIG` lives on the Rust side as a JSON string — Wave-3 T9 work. The TS layer reads the materialized config via `serviceHub.mcp().getMCPConfigs()` and caches it in `useMCPServers` zustand store; there is no parallel TS constant.)

---

## 2. The settings page renders the entry from MCP config

**File**: `web-app/src/routes/settings/mcp-servers.tsx`
**Lines**: 611-755

The page maps over every entry in `mcpServers` (zustand store, populated from Rust config) without any hard-coded list:

```tsx
Object.entries(mcpServers).map(([key, config], index) => (
  <Card key={`${key}-${index}`}>
    <CardItem
      align="start"
      title={
        <div className="flex items-center gap-x-2">
          <div className={twMerge('size-2 rounded-full', ...)} />
          <h1 className="text-foreground text-base capitalize font-studio">
            {key}
          </h1>
          {config.official && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs bg-secondary border rounded-sm">
              <img src="/images/jan-logo.png" alt="Jan" className="w-3 h-3 object-contain" />
              <span>Official</span>
            </div>
          )}
        </div>
      }
      ...
```

→ Excalidraw appears automatically because it's in `DEFAULT_MCP_CONFIG`.
→ The `Official` badge (label) is rendered for every entry with `config.official === true` — this satisfies the plan's "label `(built-in)` or `(official)`" requirement.

---

## 3. Toggle ON/OFF flow uses generic, non-special-cased Rust commands

### 3a. TS call site

**File**: `web-app/src/routes/settings/mcp-servers.tsx`
**Lines**: 331-396 (`toggleServer`); switch UI at lines 742-750

```tsx
const toggleServer = (serverKey: string, active: boolean) => {
  if (serverKey) {
    setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
    const config = getServerConfig(serverKey)
    if (active && config) {
      serviceHub
        .mcp()
        .activateMCPServer(serverKey, { ...(config ...), active })
        ...
    } else {
      ...
      serviceHub.mcp().deactivateMCPServer(serverKey)
      ...
    }
  }
}
```

The Switch component at line 743:

```tsx
<Switch
  checked={config.active}
  loading={!!loadingServers[key]}
  onCheckedChange={(checked) => toggleServer(key, checked)}
/>
```

→ The same handler is used for **every** server entry, including excalidraw. No special-casing.

### 3b. JS-bridge → Rust commands

**File**: `web-app/src/services/mcp/tauri.ts`
**Lines**: 121-127

```ts
async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
  return await invoke('activate_mcp_server', { name, config })
}

async deactivateMCPServer(name: string): Promise<void> {
  return await invoke('deactivate_mcp_server', { name })
}
```

### 3c. Rust handlers

**File**: `src-tauri/src/core/mcp/commands.rs`
**Lines**: 133-144 (activate), 146-173 (deactivate)

```rust
#[tauri::command]
pub async fn activate_mcp_server<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    config: Value,
) -> Result<(), String> {
    let servers: SharedMcpServers = state.mcp_servers.clone();
    start_mcp_server(app, servers, name, config).await
}
```

Generic by name + config — no excalidraw-specific code path. Wave-3 T11/T12 already validated that `start_mcp_server` spawns excalidraw via the same flow as any other stdio MCP.

→ Toggle ON ⇒ `start_mcp_server` ⇒ stdio process spawn.
→ Toggle OFF ⇒ removes from `mcp_active_servers`, kills child via existing teardown.

---

## 4. "(built-in)" / "(official)" badge for `official: true` — already exists, but with a bug

### 4a. Badge already exists

`mcp-servers.tsx` lines 628-637 already render an "Official" pill (Jan logo + text) for any entry with `config.official === true`. This **satisfies** the plan's label requirement without new UI code.

### 4b. Bug discovered & fixed: Jan Browser Extension note bleeds onto excalidraw

The same file at lines 667-682 used to render this block for **every** `config.official` entry:

```tsx
// BEFORE (buggy):
{config.official && (
  <div className="mt-2 text-xs text-muted-foreground pt-2">
    <p className="mb-1">
      Requires Jan Browser Extension to be installed
      in your Chrome-based browser.
    </p>
    <a href="https://chromewebstore.google.com/detail/jan-browser-mcp/...">
      Install Extension →
    </a>
  </div>
)}
```

→ Excalidraw is `official: true` but does **not** require the Jan Browser Extension. Without the fix below, the settings UI would tell users they need to install a Chrome extension to use the canvas, which is wrong.

**Fix applied** (1-line, scoped to the Jan Browser MCP key only):

```tsx
// AFTER:
{config.official && key === 'Jan Browser MCP' && (
  <div className="mt-2 text-xs text-muted-foreground pt-2">
    ...
  </div>
)}
```

Key matches the literal entry name in `DEFAULT_MCP_CONFIG` (`src-tauri/src/core/mcp/constants.rs` line 9: `"Jan Browser MCP": { ... }`).

---

## 5. Tests

Added: `web-app/src/routes/settings/__tests__/mcp-servers.official-badge.test.tsx`

Three test cases:

1. **Official badge renders for `official: true`** — asserts at least two badges (excalidraw + Jan Browser MCP) appear.
2. **Excalidraw does NOT show the Jan Browser Extension note** — asserts the "Install Extension" link appears exactly once across the rendered entries.
3. **Jan Browser MCP entry exclusively owns the extension note** — asserts the install link points at the correct Chrome Web Store URL.

The fixture (`mcpServersFixture`) includes one official-non-browser entry (excalidraw), one official-browser entry (Jan Browser MCP), and one non-official entry (fetch) so each branch is exercised.

---

## 6. Acceptance Criteria status

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Settings > MCP page shows `excalidraw` entry with toggle | ✅ | `Object.entries(mcpServers).map(...)` at L611; toggle at L742-750 |
| Toggle ON → process spawns | ✅ (transitive via T11/T12) | `activate_mcp_server` → `start_mcp_server`, no special-casing |
| Toggle OFF → process exits within 5s | ✅ (transitive via T11/T12) | `deactivate_mcp_server` removes from active map; existing teardown handles child kill |
| `official: true` badge or label visible | ✅ | "Official" pill at L628-637 |
| **Bonus**: Jan Browser Extension note no longer leaks onto excalidraw | ✅ | Scoped to `key === 'Jan Browser MCP'` at L667 |

The runtime-spawn / process-kill criteria are already covered by Wave-3 verification (T11, T12); this task does not duplicate that work — it confirms the UI piggybacks on the same flow with zero special-casing.

---

## 7. Files touched in this task

| File | Type | Purpose |
|------|------|---------|
| `web-app/src/routes/settings/mcp-servers.tsx` | edit (1 line) | Scope Jan Browser Extension note to its entry only |
| `web-app/src/routes/settings/__tests__/mcp-servers.official-badge.test.tsx` | new | Lock in badge + scoped-note behavior |
| `.sisyphus/evidence/task-21-verification.md` | new | This document |
| `.sisyphus/evidence/task-21-config-snapshot.json` | new | Snapshot of excalidraw entry from `DEFAULT_MCP_CONFIG` |
| `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` | edit | Tick the Wave-5 T21 checkboxes |
| `.sisyphus/notepads/excalidraw-mcp-canvas-integration/{learnings,decisions}.md` | append | Capture findings |
