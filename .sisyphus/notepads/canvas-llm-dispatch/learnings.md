# Learnings â€” canvas-llm-dispatch

<!-- Append only. Never overwrite. Format: ## [TIMESTAMP] Task: {task-id} -->

## [2026-06-17] Task: T3
CanvasAiIndicator progress prop: optional, renders "(N/M)" inline after label. data-testid="canvas-ai-indicator-counter" on counter span.

## [2026-06-17] Task: T4
CanvasModelPicker: uses useModelProvider (Zustand store, @/hooks/useModelProvider) for models list via selector (state) => state.providers, shadcn DropdownMenu. Props: selectedModel: ModelInfo | null, onModelChange: (model: ModelInfo) => void, disabled?: boolean. ModelInfo is a local type { id, name, provider } derived from Model + ModelProvider. Embedding models filtered out. 14/14 tests pass, LSP clean, tsc -b --noEmit zero errors.

## [2026-06-17] Task: T5a ï¿½ Bulk-batch approval token

### Real tool names (curated-tools.ts)
- Mutating tools: create_element, update_element, delete_element, atch_create_elements, etc.
- Readonly tools: query_elements, get_element, describe_scene, get_resource, ead_diagram_guide
- Blocked tools: export_to_image, get_canvas_screenshot
- Tests must use actual names from EXCALIDRAW_MUTATING_TOOLS / EXCALIDRAW_READONLY_TOOLS ï¿½ generic names like dd_rectangle fall through Gate 1 and tests fail silently

### Instance arrow pattern for non-responsibility methods
- setThreadId, setBatchApproval, clearBatchApproval, pplyDuringBatch, orceEndBatch, isManualEditLocked, subscribeManualEditLock, everseTranslateElementId, egisterUserElement, 	ranslateToolResultByName are all instance arrows
- Prototype methods that appear in OrchestratorResponsibility: the 11 named ones only
- Object.prototype.hasOwnProperty.call(instance, 'methodName') returns true for instance arrows, false for prototype methods ï¿½ useful test assertion

### Backward-compatible optional arg pattern
- dispatchExcalidrawTool(call, deps, options?) ï¿½ third arg optional, undefined = old behavior
- Existing 17 dispatch.test.ts tests needed zero modification (backward compatible confirmed)
- Telemetry emitted on BOTH paths: atch.bulk_approved (token present) and atch.per_call_approved (no token, approval path) ï¿½ allows analytics to distinguish batch vs interactive approval rates

### tsc with no output = zero errors
- 
px tsc --noEmit producing no stdout = clean (all errors print to stdout on Windows)

## [2026-06-17] Task: T5b

### Store already implemented â€” check before coding
- `useToolApproval.ts` already had `requestBatchApproval`, `resolveBatchApproval`, `BatchApprovalChoice`, `BatchApprovalRequest` fully implemented. Always read the target file before writing implementation â€” avoids duplicate work.

### Vitest path filter syntax on Windows
- `node_modules/.bin/vitest.cmd --run src/hooks/useToolApproval` does NOT find files â€” vitest filter must match test file paths including `__tests__/` subdirectory.
- Correct: `node_modules/.bin/vitest.cmd --run "src/hooks/__tests__/useToolApproval" "src/containers/dialogs/__tests__/ToolApproval"`

### Dialog test mocking pattern
- Mock `@/components/ui/dialog` with minimal stubs that render children directly (no portals). Use `open` prop to conditionally render `null` â€” prevents false positive renders when `open=false`.
- Mock `@/components/ui/button` as a plain `<button>` pass-through to retain `onClick` and arbitrary props (including `data-testid`).

### beforeEach store reset â€” include all slices
- Existing `beforeEach` only reset `approvedTools, allowAllMCPPermissions, isModalOpen, modalProps`. New tests need `pending: {}` and `batchApprovalRequest: null` reset too. Updated top-level `beforeEach` to include all state slices.

### Bulk modal data-testid placement
- `data-testid="tool-approval-bulk-modal"` goes on an inner `<div>` wrapper inside `DialogContent`, not on `<Dialog>` or `<DialogContent>` directly. This ensures `screen.getByTestId` works regardless of how Dialog is mocked.

### ToolApproval.tsx mode guard order
- `if (batchApprovalRequest)` check at top, before `if (!modalProps)` check. Guarantees bulk variant is always rendered when a batch request is pending, even if modalProps is somehow also set.

## [2026-06-17] Task: T7

### apply.ts signature vs task spec discrepancy
- Task spec Â§2 describes the new signature as `(mutations: CanvasMutation[], ...)` but the real call site (`$canvasId.tsx` line 354) passes `McpToolResult`. Always read the call site before trusting spec parameter names â€” the stub signature is authoritative.
- Internal flow: `McpToolResult` â†’ `orchestrator.translateToolResult(result)` â†’ `CanvasMutation[]` â†’ dispatch loop.

### CanvasMutation dispatch table
- `add` â†’ `applyDuringBatch(mutation.elements)` directly (elements already built by result-translator with canvas ids)
- `update` â†’ build `{ id, ...patch }` per id, one call: `applyDuringBatch(elements)`. No scene fetch needed â€” `updateScene(NEVER)` merges into existing snapshot.
- `delete` â†’ build `{ id, isDeleted: true }` stubs, `applyDuringBatch(elements)`. Excalidraw tombstone pattern.
- `reorder` â†’ no `applyDuringBatch` call â€” ordering-only signal, not an element push.
- `noop` â†’ silently skipped.

### `applyDuringBatch` is an instance arrow on the orchestrator
- Declared as `applyDuringBatch: (elements: ExcalidrawElement[]) => void = (elements) => this.batch.applyDuringBatch(elements)` â€” not a prototype method. This is the same pattern as `setThreadId`, `reverseTranslateElementId`, etc. Arrow properties don't appear in prototype reflection tests.

### Vitest runner on Windows: use workdir param, not `&&`
- PowerShell 5.1 does not support `&&`. Chain with `;` or use `workdir` parameter on bash tool. `node_modules/.bin/vitest.cmd --run <pattern>` works from `web-app/` workdir.

### Per-mutation error handling: catch at the switch level, not outer
- Wrapping the entire `switch` block in try/catch per mutation means one bad `applyDuringBatch` call cannot abort remaining mutations. The outer loop always continues.

### `tsc --noEmit` produces no output on clean pass
- Zero output = zero errors. Do not interpret silence as a failure.

## [2026-06-17] Task: T8

### CanvasPromptBar three-state button pattern
- Import Square from lucide-react alongside ArrowRight and Loader2`n- Conditional render: {isSubmitting && onStop ? <StopBtn/> : <SendBtn/>} — the ternary keeps the Stop and Send/Loader buttons mutually exclusive
- Stop button must be 	ype=button (not 	ype=submit) to prevent form submission on click
- Send button keeps data-testid=canvas-prompt-send; Stop button gets data-testid=canvas-prompt-stop`n
### Esc handler — two-path extension pattern
- Extend the existing window keydown useEffect rather than adding a second listener
- Add orchestratorState and handleStop to deps array when the handler references them
- Input guard: check e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement for the abort path (simpler than checking document.activeElement.tagName)
- The submitting-path guard runs BEFORE the idle-path editable/excalidraw checks — short-circuit order matters
- e.stopPropagation() (not e.preventDefault()) is the right call: stops the event reaching the navigate branch, doesn't block browser default Esc behavior

### Test pattern: capturing extra props from existing mock
- The i.mock factory for CanvasPromptBar was already capturing capturedOnSubmit; extend the factory type and add capturedOnStop = props.onStop inline
- Declare capturedOnStop at module scope alongside other captures; reset in the global eforeEach`n- Don't use i.doMock inside a describe block to extend a hoisted mock — extend the original factory instead

### T9 failures are pre-existing
- 4 T9 tests fail on canvas-error-banner-stub not found — CanvasErrorBanner is not yet wired in the route JSX
- These were failing before T8; zero T8 regressions confirmed

## [2026-06-17] Task: T10 - Auto-save coordination during batch

### Key patterns
- `vi.hoisted()` is required when `vi.mock` factory needs to reference module-level variables â€” without it, vitest's hoist of `vi.mock` causes "Cannot access before initialization" ReferenceError
- `saveFnRef.current = async () => {...}` pattern (reassign on every render) lets the debounced wrapper delegate to always-fresh logic without recreating the lodash debounce instance. The ref itself is stable; only its `.current` is updated.
- `flushOnce` calls `saveFnRef.current()` directly â€” bypasses lodash pending-call bookkeeping. Necessary because `debounced.flush()` is a no-op if the timer already fired (even if the fn returned early due to lock guard).
- `debounceMs: 0` in tests + `vi.useFakeTimers()` + `vi.runAllTimers()` is reliable for testing debounced async code; need 2x `await Promise.resolve()` after to let microtasks settle.
- Canvas route: `subscribeManualEditLock` observer signature is `(locked: boolean, refCount: number) => void` â€” the `locked` boolean is the first arg, usable directly.
- `flushOnce` must be in `useEffect` deps array when used inside an effect (ESLint exhaustive-deps).
- PowerShell `[System.IO.File]::WriteAllText(..., [System.Text.Encoding]::UTF8)` is the reliable way to write UTF-8 files without BOM-related encoding corruption in this environment.

## [2026-06-17] Task: T9

### CanvasErrorBanner positioning
- top-12 (not top-3 like lock banner) so both can coexist simultaneously without pixel overlap
- Container pointer-events-none; buttons get pointer-events-auto individually — canvas stays interactive
- role=alert + aria-live=assertive (error is urgent, unlike lock banner's polite)

### retryFromIndex tracking
- Use local successCount variable incremented after each successful dispatch — cleaner than reading React state in async context
- Avoids functional-updater trick (setProgress updater calling setErrorState) which is fragile and hard to reason about

### vi.mock placement in existing test file
- vi.mock() calls are hoisted — placing them after existing describe blocks still works correctly
- Duplicate let declarations at module scope cause esbuild transform errors — remove any re-declaration that already exists at module top

### Route wiring pattern
- handleRetry: own dispatch loop, new AbortController, starts from retryFromIndex, no sendMessage call
- handleDismissError: clears errorState + mirrors finally block cleanup (endAiBatch + clearBatchApproval + unlock)
- errorState mounted outside isExcalidrawActive gate — error could persist even if toggle changes

## [2026-06-17] Task: T11 - Mini picker integration into CanvasPromptBar

### ReactNode slot injection pattern
- CanvasPromptBar gets `modelPicker?: ReactNode` prop; renders it between Input and send/stop button.
- Parent (route) owns the picker import — CanvasPromptBar stays generic and independently testable.
- Slot renders nothing when prop is omitted: existing layout unchanged, all prior tests pass without modification.

### CanvasPromptBar mock must RENDER the slot
- Integration tests mock CanvasPromptBar. If the mock returns `<div />` and ignores modelPicker, the CanvasModelPicker stub inside the slot never executes.
- Fix: mock returns `<div data-testid="canvas-prompt-bar">{props.modelPicker}</div>` — this causes the picker stub to render and populate capturedModelPickerProps.

### useModelProvider.getState() in useState initializer
- Route uses `useState(() => useModelProvider.getState().selectedModel ?? null)` to snapshot the global default once on mount.
- Test mock must expose both the hook call surface AND `.getState()`: `Object.assign(hookFn, { getState: () => store })`.
- Setting `mockSelectedModelStore.selectedModel` in beforeEach controls the initial state for each test.

### Type bridge: local ModelInfo vs @janhq/core ModelInfo
- CanvasModelPicker exports its own `ModelInfo = { id, name, provider }`.
- useCanvasChat expects `model: ModelInfo` from `@janhq/core` (different package).
- Global `Model` from useModelProvider has `id`, `name/displayName` but no `provider` field directly.
- Pattern: `(selectedModel ?? fallback) as never` is the approved cast (matches T1 precedent of `placeholderModel.current as never`).
- Map global state: `displayName ?? name ?? id` for display; `selectedProvider` for provider.

### 56/56 tests pass, tsc --noEmit zero new errors

## [2026-06-17] Task: T1-bugfix-late-binding

The late-binding pattern requires a **getter function**, not a value, when passing dependencies to sub-controllers constructed at class instantiation time.

**Root cause:** createBatchController({ excalidrawAPI: deps.excalidrawAPI }) captured the VALUE of deps.excalidrawAPI at construction time — always undefined because Excalidraw mounts asynchronously after the orchestrator is constructed. The route's useEffect later patches orchestrator.deps.excalidrawAPI, but atch.ts had already closed over the stale undefined.

**Fix pattern:** Pass () => this.deps.excalidrawAPI (an arrow function getter) instead of 	his.deps.excalidrawAPI (the value). Inside atch.ts, resolve via a helper:
```ts
const getExcalidrawAPI = (): ExcalidrawApiLike | undefined =>
  typeof deps.excalidrawAPI === 'function'
    ? deps.excalidrawAPI()
    : deps.excalidrawAPI
```

**Why the union type:** Tests pass the value form directly (excalidrawAPI: mockApi), so the type must accept both forms. 	ypeof === 'function' distinguishes them at runtime.

**Key insight:** When a sub-controller is constructed eagerly (in a constructor) but the dependency is populated lazily (after mount), the sub-controller must receive a reference to a live source (getter/ref), not a snapshot of the value at construction time.
