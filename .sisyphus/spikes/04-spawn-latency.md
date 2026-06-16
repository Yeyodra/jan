# Spike 04 — First-spawn latency for bun + mcp_excalidraw

**Status**: PASS-WITH-CAVEAT
**Date**: 2026-06-16
**Wave / Task**: Wave 1 / T4
**Branch**: `feat/excalidraw-mcp`
**Plan ref**: `.sisyphus/plans/excalidraw-mcp-canvas-integration.md` lines 695-779

## Verdict

**PASS-WITH-CAVEAT** — cold-spawn latency measured across two paths:

1. **Inspector CLI path** (npx-wrapped, upper bound): **mean 7546.4 ms**, stdev 238.6 ms (3.2% of mean — very stable). Dominated by Inspector CLI's own Node startup.
2. **Direct stdio path** (matches what Jan's `TokioChildProcess` will actually do): **mean 381.8 ms**, stdev 8.3 ms (2.2% of mean — extremely stable).

The direct-stdio number (~382 ms mean) is what production Jan users will experience for the first canvas tool call after enabling Excalidraw in Settings. This is **below the 800 ms plan-threshold** but **above the 300 ms "indicator-can-be-deferred" threshold**. The "AI is drawing…" indicator must appear within ≤ 200 ms of send-button click to feel responsive.

**Caveat**: the runs.txt raw file reports "30 tools" — this is a `"name"`-substring counting artifact (parameter names in `inputSchema.properties` also match). True tool count parsed from `.result.tools.length` is **26**, which matches T2's report and the plan. T8's allow-list count remains 26.

T19 (CanvasAiIndicator) UX design is **unblocked** with concrete numbers.

## Setup

All measurement work happened in `C:\Users\Nazril\AppData\Local\Temp\opencode\mcp_excalidraw_spike\mcp_excalidraw\` — no Jan production code (Rust/TS) was touched. No `tracing::info!` instrumentation was added to `helpers.rs`; wall-clock measurement of the bundled stack proved sufficient and avoided commit churn (per plan §line 712).

### Toolchain (system)

| Component | Version |
|-----------|---------|
| bun       | 1.3.14 |
| node      | v24.15.0 |
| OS        | Windows 11 / PowerShell 5.1 |

### Source pin (verified)

```
repo:   https://github.com/yctimlin/mcp_excalidraw.git
SHA:    c12ff87f6d607ccac7b217ae415bee8d855a067e   (verified via git rev-parse HEAD)
build:  npm run build → dist/index.js (95755 bytes)
```

Same pin as T2 — no rebuild was needed.

### Why two measurement paths?

The plan asked for "user pencet send → first tools/list resolves" wall-clock. The most accessible MCP client on Windows is `@modelcontextprotocol/inspector --cli`, which is what T2 used. That wrapper, however, spawns its own Node process and pays its own startup tax (~7 seconds). To get a number that's actually representative of Jan's `TokioChildProcess` path — where rmcp spawns `bun dist/index.js` directly and speaks MCP over stdio with no intermediate Node process — a second path was added: stdin-pipe JSON-RPC frames (`initialize` → `notifications/initialized` → `tools/list`) directly to `bun dist/index.js` and time from spawn to the `id:2` response.

The direct-stdio path is what production Jan will pay. The Inspector path is reported for transparency and as an upper bound.

### Cold-spawn isolation

Between every run, all leftover `bun.exe` and `node.exe` processes were killed via `Stop-Process -Force`, followed by an 800 ms settle. This ensures each run is a true cold spawn (no warm OS file cache benefits accumulating from a previous run — modulo Windows' filesystem cache, which we cannot purge without rebooting).

### npx cache

A throwaway warm-up call to `npx --yes @modelcontextprotocol/inspector` was run before the 5-run Inspector loop, so the Inspector path numbers exclude npx fetch cost. T2 already established that cold npx fetch is ~35 seconds — that's not what we wanted to measure here.

## Results

### Path 1: Inspector CLI wrapper (upper bound)

Command per run:
```powershell
npx --yes @modelcontextprotocol/inspector --cli `
  -e ENABLE_CANVAS_SYNC=false -- `
  bun "<scratch>/dist/index.js" --method tools/list
```

| Run | Wall-clock (ms) |
|-----|-----------------|
| 1   | 8010 |
| 2   | 7535 |
| 3   | 7403 |
| 4   | 7418 |
| 5   | 7366 |

**Mean: 7546.4 ms · Stdev: 238.6 ms (3.2% of mean) · Min: 7366 ms · Max: 8010 ms**

### Path 2: Direct stdio (production-representative)

Per run, pipe JSON-RPC frames over stdin and time spawn → `id:2` response:
```powershell
$payload = "<initialize>`n<notifications/initialized>`n<tools/list>`n"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$payload | bun "<scratch>/dist/index.js"
$sw.Stop()  # ms = full wall-clock incl. handshake + tools/list serialization
```

| Run | Wall-clock (ms) | id:2 frames received |
|-----|-----------------|----------------------|
| 1   | 398 | 1 |
| 2   | 379 | 1 |
| 3   | 375 | 1 |
| 4   | 377 | 1 |
| 5   | 380 | 1 |

**Mean: 381.8 ms · Stdev: 8.3 ms (2.2% of mean) · Min: 375 ms · Max: 398 ms**

### Phase breakdown (what the wall-clock includes)

We did not add per-phase tracing (out of scope for a spike). The direct-stdio wall-clock window contains:

| Phase | Approximate contribution |
|-------|--------------------------|
| Bun process spawn + JS engine init | dominant chunk (~250-300 ms — known bun startup cost on Windows) |
| Loading `dist/index.js` (95 KB bundled) | small (~20-40 ms) |
| MCP handshake (`initialize` → `initialized`) | small (~10-20 ms — no I/O, in-process) |
| `tools/list` serialization (26 tools) | small (~5-10 ms) |
| stdin/stdout pipe latency | small (~10-20 ms) |

Approximate breakdown is informed by typical bun-on-Windows numbers; precise per-phase breakdown would require instrumenting `helpers.rs` (rejected — production change for a spike). The numbers are tight enough (stdev 8.3 ms over 5 runs) that the bun startup is the clear dominant cost.

## Tool count anomaly — investigation and resolution

The raw runs.txt reports 30 tools. T2's report and the plan say 26. Discrepancy investigated:

- The "30" comes from `($resp | Select-String '"name"' | Measure-Object).Count` — a counting heuristic that matches every `"name"` substring in the response.
- A tools/list JSON-RPC response contains `"name"` keys at multiple levels: each tool's `name`, plus parameter names inside `inputSchema.properties`. Several mcp_excalidraw tools have a `"name"` parameter (e.g., for `create_element`, the type field may include names).
- Reparsing one response via `ConvertFrom-Json` and counting `.result.tools.Count` returns **26**, matching T2 exactly.
- First 5 tool names verified: `create_element`, `update_element`, `delete_element`, `query_elements`, `get_resource` — consistent with mcp_excalidraw @ c12ff87.

**Resolution**: T8's allow-list / per-tool wiring count is **26 tools** (not 30). The runs.txt "tool count" column is a measurement-script artifact, not a real change in the dependency.

## Recommendation for T19 (CanvasAiIndicator) UX

Per plan §line 702: "cold spawn > 800 ms ⇒ indicator must show within 200 ms of send button click."

Production-relevant cold spawn (direct-stdio path) = **382 ms mean**, well below the 800 ms threshold but above the 300 ms "indicator-can-be-deferred-150 ms" threshold.

**Recommendation**:
- Show the "AI is drawing…" indicator within **≤ 200 ms of send-button click** anyway. Rationale:
  1. 382 ms is the mean for warm OS filesystem cache. Cold-cache (first time after PC reboot, or after Excalidraw config toggle) will be higher — bun startup on Windows can spike to 700-1000 ms when nothing is in the OS file cache. We did not measure post-reboot cold; treating the 382 ms as a best case.
  2. Tools after the first one will be sub-100 ms (process is already running, persistent stdio session). Hiding the indicator on those is fine. Only the FIRST tool call per Jan session is expensive.
  3. 200 ms is the perceptual threshold for "instantaneous" feedback; anything longer than that without UI movement feels frozen.
- After the first tool call resolves, the indicator should auto-hide. For subsequent tool calls in the same session, defer the indicator (only show after 150 ms of pending state).
- If subsequent telemetry shows P95 cold spawn exceeds 800 ms in real Jan deployments, the indicator UX is already correctly designed for that regime — no change needed.

### Honesty checks

- **Stdev is tight** (3.2% Inspector path, 2.2% direct path on 5 samples) — no need for re-measurement under more controlled conditions.
- **The 382 ms direct-spawn number is the best estimate** for what Jan will see. The Inspector CLI's 7.5 s is irrelevant to production but is reported here for full transparency about the measurement methodology.
- **What was NOT measured**: post-reboot cold-OS-cache scenario, anti-virus on-access scan overhead, slow-disk hosts (HDD vs SSD). These could push the real-world P95 higher; the 200 ms indicator budget is the conservative choice that handles all those cases.

## Evidence

- `.sisyphus/evidence/task-4-spawn-runs.txt` — raw 5-run output for both paths
- `.sisyphus/evidence/task-4-spawn-summary.json` — structured numbers (`inspector_cli_path` + `direct_spawn_path` with per-run ms, mean, stdev, max, min)

## Conclusion

Cold-spawn latency for bun + mcp_excalidraw is **382 ms mean** on the production-representative path (Windows, warm OS cache, direct stdio). The "AI is drawing…" indicator (T19) should appear within **≤ 200 ms** of send-button click for the first tool call in a Jan session. Subsequent tool calls in the same session can defer the indicator to 150 ms of pending state.

T19 design is unblocked.
