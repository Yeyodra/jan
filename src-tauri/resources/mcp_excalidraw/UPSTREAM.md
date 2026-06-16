# mcp_excalidraw — Vendored Snapshot

- **Source**: https://github.com/yctimlin/mcp_excalidraw
- **Pinned commit**: `c12ff87f6d607ccac7b217ae415bee8d855a067e`
- **Pinned commit URL**: https://github.com/yctimlin/mcp_excalidraw/commit/c12ff87f6d607ccac7b217ae415bee8d855a067e
- **Vendor date**: 2026-06-16
- **License**: MIT (see `LICENSE` in this directory; verbatim from upstream)
- **SHA-256(dist/index.js)**: `DC1E55ED8C1CB2E2354794C8FDE34A707D3B6E9E824C617C949B550106EFA0BC`

## Build-time install (node_modules)

`node_modules/` is **NOT** vendored. The Tauri build hook (see Task 11 in
`.sisyphus/plans/excalidraw-mcp-canvas-integration.md`) runs `npm ci` inside
this directory at build time, producing `node_modules/` alongside the
already-vendored `dist/`.

Repo-size hygiene drove this decision: a full `node_modules` for this package
pulls hundreds of MBs of transitive deps, most of which are devDependencies
only needed for the `dist/` build step (which has already been run and the
output committed). The runtime `dist/index.js` still requires a subset of
`dependencies` from `package.json` at execution time, hence T11's build-time
install.

The `src-tauri/resources/mcp_excalidraw/node_modules/` path is `.gitignore`d
at the repo root to ensure T11's runtime install never gets committed.

## How to bump the pinned SHA

1. `cd src-tauri/resources && Remove-Item -LiteralPath mcp_excalidraw -Recurse -Force`
2. `git clone https://github.com/yctimlin/mcp_excalidraw.git`
3. `cd mcp_excalidraw && git checkout <NEW_SHA>`
4. `npm ci && npm run build`
5. Recompute `(Get-FileHash dist/index.js -Algorithm SHA256).Hash` and update this file
6. `Remove-Item -LiteralPath .git -Recurse -Force; Remove-Item -LiteralPath node_modules -Recurse -Force`
7. Update top-level `NOTICE` (Task 6) if upstream license terms changed
8. Commit: `chore(mcp): bump mcp_excalidraw to <SHORT_SHA>`

## Contract for downstream tasks

- **Task 11 (Tauri build hook)** must verify the SHA-256 of `dist/index.js`
  against the value above before launching the sidecar. Mismatch = abort.
- **Task 9-12 (Tauri wiring + orchestrator)** must spawn this server via
  `bun src-tauri/resources/mcp_excalidraw/dist/index.js` and never modify
  any file under this directory at runtime.
