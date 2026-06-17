# Spike 02 — bun runtime executes mcp_excalidraw stdio transport

**Status**: ✅ PASS-WITH-CAVEATS
**Date**: 2026-06-16
**Wave / Task**: Wave 1 / T2
**Branch**: `feat/excalidraw-mcp`
**Plan ref**: `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` lines 519-603

## Verdict

**PASS-WITH-CAVEATS** — bun 1.3.14 cleanly executes the Node-built `dist/index.js`
of mcp_excalidraw at the pinned SHA over MCP stdio transport. `tools/list` returns
the expected **26 tools** and round-trips in ~5s (cached) / ~40s (cold, including
npx fetch of MCP Inspector). One caveat: harmless `npm warn deprecated` lines fire
during the cold `npx` fetch — these come from the Inspector's transitive deps, not
mcp_excalidraw itself. Boot of the spawned mcp_excalidraw process is silent on
stderr.

T5 (vendor mcp_excalidraw) is **unblocked**.

## Toolchain (system)

| Component | Version |
|-----------|---------|
| bun       | 1.3.14  |
| node      | v24.15.0 |
| npm       | 11.12.1 |
| git       | 2.54.0.windows.1 |
| OS        | Windows / PowerShell 5.1 |

## Source pin

```
repo:   https://github.com/yctimlin/mcp_excalidraw.git
SHA:    c12ff87f6d607ccac7b217ae415bee8d855a067e
verify: git -C mcp_excalidraw rev-parse HEAD → c12ff87f6d607ccac7b217ae415bee8d855a067e
HEAD msg: "Merge pull request #83 from yctimlin/pr-82-hardened-log-path"
scratch: C:\Users\Nazril\AppData\Local\Temp\opencode\mcp_excalidraw_spike\mcp_excalidraw
```

## Build summary

```
npm ci         → 566 packages added in ~23s
                 29 vulnerabilities reported (informational only — upstream concern,
                 not blocking for spike); 1 deprecation warning (node-domexception)
npm run build  → vite v6.4.1 frontend build (2007 modules, ~ok bundle sizes) +
                 server tsc build → dist/{index.js, server.js, types.js, *.d.ts, *.map}
                 dist/index.js exists, 95755 bytes
                 dist/frontend/ + dist/utils/ subdirs populated
```

Both build sub-steps finished clean (no errors).

## Happy path: bun + MCP Inspector tools/list

Command (executed in scratch dir):
```
npx --yes @modelcontextprotocol/inspector --cli \
  -e ENABLE_CANVAS_SYNC=false -- \
  bun dist/index.js --method tools/list
```

| Run | Wall-clock | Notes |
|-----|-----------|-------|
| Cold (first invocation, includes npx fetch + cache populate) | **39,853 ms** | npm warns from Inspector transitive deps, then JSON |
| Warm (repeat after npx cache populated)                     | **5,128 ms**  | clean JSON, minimal overhead |

The 39.8s cold-start is dominated by `npx --yes @modelcontextprotocol/inspector`
downloading and resolving the Inspector package; bun + mcp_excalidraw boot is
sub-second within that envelope. Steady-state stdio handshake is ~5s, of which
most is again Inspector setup. The mcp_excalidraw process itself emits no stderr
during boot under `ENABLE_CANVAS_SYNC=false`.

### tools/list output

Total tools: **26** (matches plan acceptance criterion).

Names (in response order):
```
1.  create_element
2.  update_element
3.  delete_element
4.  query_elements
5.  get_resource
6.  group_elements
7.  ungroup_elements
8.  align_elements
9.  distribute_elements
10. lock_elements
11. unlock_elements
12. create_from_mermaid
13. batch_create_elements
14. get_element
15. clear_canvas
16. export_scene
17. import_scene
18. export_to_image          ← hard-exclude target (T8)
19. duplicate_elements
20. snapshot_scene
21. restore_snapshot
22. describe_scene
23. get_canvas_screenshot    ← hard-exclude target (T8)
24. read_diagram_guide
25. export_to_excalidraw_url
26. set_viewport
```

Cross-check against README expectation buckets (Element CRUD / Layout / Scene
Awareness / File I/O / State / Viewport / Design Guide / Resources): all 7
buckets represented. No surprise tools, no missing tools.

Raw JSON evidence: `.sisyphus/evidence/task-2-bun-tools-list.json`

## Stderr warnings

Captured during cold `npx` setup (NOT from mcp_excalidraw):
```
npm warn deprecated inflight@1.0.6
npm warn deprecated glob@7.2.3
npm warn deprecated node-domexception@1.0.0
```

These originate from `@modelcontextprotocol/inspector`'s transitive deps. They
do not appear in warm runs and do not affect the MCP handshake. **Not blocking.**

mcp_excalidraw itself produced **zero stderr output** during boot in both cold and
warm runs with `ENABLE_CANVAS_SYNC=false`. (When `ENABLE_CANVAS_SYNC=true` and the
Express server is unreachable, the handler emits a connect-error per tools/call —
see negative test below — but boot remains clean.)

## Negative test: hard-exclude justification

Two tools the plan flags for Wave 2 hard-exclude (`export_to_image`,
`get_canvas_screenshot`) were invoked via tools/call with the canvas Express
server (`npm run canvas`) **not started**, wrapped in a 15s PowerShell job
timeout:

| Tool                  | Status                       | Elapsed | Result |
|-----------------------|------------------------------|---------|--------|
| export_to_image (png) | COMPLETED_BEFORE_TIMEOUT     | 6181 ms | `{ isError: true, content: [{ text: "Error: Unable to connect. Is the computer able to access the url?" }] }` |
| get_canvas_screenshot | COMPLETED_BEFORE_TIMEOUT     | 5204 ms | (same shape) |

**Hang prediction NOT reproduced** in this environment — both tools error
quickly rather than hanging — but the hard-exclude rationale still holds for
T8 because:

1. The tools are functionally non-operational without the Express server (which
   plan T2 §Must NOT do explicitly forbids running).
2. Advertising broken tools pollutes Jan's LLM tool-selection heuristics.
3. With `ENABLE_CANVAS_SYNC=true` and an unreachable Express server, the same
   handlers can block on outbound fetch retries (per source inspection of
   mcp_excalidraw's `dist/index.js`).

Full evidence: `.sisyphus/evidence/task-2-export-to-image-hangs.txt`

## Acceptance criteria

| Criterion (plan line 570) | Result |
|---------------------------|--------|
| bun version recorded                      | ✅ 1.3.14 |
| MCP handshake time recorded               | ✅ ~5s warm / ~40s cold |
| tools count returned                      | ✅ 26 |
| stderr (if any) recorded                  | ✅ documented (npx-side warns only) |
| Spike report at `.sisyphus/spikes/02-bun-runtime.md` | ✅ this file |
| `tools/list` JSON evidence captured       | ✅ `task-2-bun-tools-list.json` |
| Negative test for hard-exclude            | ✅ `task-2-export-to-image-hangs.txt` |

## Implications for downstream tasks

- **T5 (vendor mcp_excalidraw)** — UNBLOCKED. Confirmed bun-runs-it. Vendor at
  same SHA `c12ff87f6d607ccac7b217ae415bee8d855a067e`.
- **T8 (hard-exclude registry projection)** — exclude list = `["export_to_image",
  "get_canvas_screenshot"]` (both confirmed present, both confirmed
  non-operational without Express server). Net surfaced tools after exclusion: 24.
- **Production runtime contract** (per plan §helpers.rs:570-610) — must spawn with
  env `ENABLE_CANVAS_SYNC=false`. Boot is silent under that flag.
- **Bun 1.3.x stdio bug (Metis warning)** — no symptoms observed in 1.3.14 for
  the read-only tools/list path; further validation under load is a Wave 3
  concern, not a blocker for current waves.

## Reproduction

```powershell
# Scratch dir (pre-approved external path)
$scratch = "C:\Users\Nazril\AppData\Local\Temp\opencode\mcp_excalidraw_spike"
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
Set-Location -LiteralPath $scratch

# Clone + pin
git clone https://github.com/yctimlin/mcp_excalidraw.git
Set-Location -LiteralPath "$scratch\mcp_excalidraw"
git checkout c12ff87f6d607ccac7b217ae415bee8d855a067e
git rev-parse HEAD   # → c12ff87f6d607ccac7b217ae415bee8d855a067e

# Build with system Node
npm ci
npm run build
Test-Path -LiteralPath "dist\index.js"   # → True

# Verify bun runtime
bun --version   # → 1.3.14
npx --yes @modelcontextprotocol/inspector --cli `
  -e ENABLE_CANVAS_SYNC=false -- `
  bun dist/index.js --method tools/list
```
