# Task 3 — `captureUpdate` source-of-truth quote

**Method:** Read upstream type declarations from the locally installed package; no network fetch needed.

**Package + version (from `web-app/package.json` L26):**
```
"@excalidraw/excalidraw": "0.18.1"
```

**Package entry (from `web-app/node_modules/@excalidraw/excalidraw/package.json`):**
```json
{
  "name": "@excalidraw/excalidraw",
  "version": "0.18.1",
  "type": "module",
  "types": "./dist/types/excalidraw/index.d.ts",
  "main": "./dist/prod/index.js",
  "exports": {
    ".": {
      "types": "./dist/types/excalidraw/index.d.ts",
      ...
    }
  }
}
```

**Public re-export of the enum (`dist/types/excalidraw/index.d.ts` L23):**
```ts
export { CaptureUpdateAction } from "./store";
```
→ `CaptureUpdateAction` is part of the package's public API surface, importable as
`import { CaptureUpdateAction } from '@excalidraw/excalidraw'` (runtime value, not just a type).

---

## Enum definition — verbatim quote

`web-app/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/store.d.ts` lines 7-39:

```ts
export declare const CaptureUpdateAction: {
    /**
     * Immediately undoable.
     *
     * Use for updates which should be captured.
     * Should be used for most of the local updates.
     *
     * These updates will _immediately_ make it to the local undo / redo stacks.
     */
    readonly IMMEDIATELY: "IMMEDIATELY";
    /**
     * Never undoable.
     *
     * Use for updates which should never be recorded, such as remote updates
     * or scene initialization.
     *
     * These updates will _never_ make it to the local undo / redo stacks.
     */
    readonly NEVER: "NEVER";
    /**
     * Eventually undoable.
     *
     * Use for updates which should not be captured immediately - likely
     * exceptions which are part of some async multi-step process. Otherwise, all
     * such updates would end up being captured with the next
     * `CaptureUpdateAction.IMMEDIATELY` - triggered either by the next `updateScene`
     * or internally by the editor.
     *
     * These updates will _eventually_ make it to the local undo / redo stacks.
     */
    readonly EVENTUALLY: "EVENTUALLY";
};
export type CaptureUpdateActionType = ValueOf<typeof CaptureUpdateAction>;
```

The string values themselves (`"IMMEDIATELY"`, `"NEVER"`, `"EVENTUALLY"`) are the exact wire values; the same literal strings are the runtime values when read off the `CaptureUpdateAction` object.

---

## `updateScene` payload shape — verbatim quote

`web-app/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts`:

L21 (the import that wires the enum to `updateScene` payloads):
```ts
import type { CaptureUpdateActionType } from "./store";
```

L464-469 — `SceneData`, the payload accepted by `updateScene`:
```ts
export type SceneData = {
    elements?: ImportedDataState["elements"];
    appState?: ImportedDataState["appState"];
    collaborators?: Map<SocketId, Collaborator>;
    captureUpdate?: CaptureUpdateActionType;
};
```

→ The field is named `captureUpdate` (camelCase) on the `SceneData` object passed to `excalidrawAPI.updateScene(...)`. Its value type is `CaptureUpdateActionType` = one of the three string literals above.

---

## Imperative API surface — verbatim quote

`web-app/node_modules/@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts` L603-613:

```ts
export interface ExcalidrawImperativeAPI {
    updateScene: InstanceType<typeof App>["updateScene"];
    updateLibrary: InstanceType<typeof Library>["updateLibrary"];
    resetScene: InstanceType<typeof App>["resetScene"];
    getSceneElementsIncludingDeleted: InstanceType<typeof App>["getSceneElementsIncludingDeleted"];
    history: {
        clear: InstanceType<typeof App>["resetHistory"];
    };
    getSceneElements: InstanceType<typeof App>["getSceneElements"];
    getAppState: () => InstanceType<typeof App>["state"];
    getFiles: () => InstanceType<typeof App>["files"];
    ...
};
```

Notes:
- `excalidrawAPI.history` only exposes `clear` — there is **no public `undo()` / `redo()` method**. Undo/redo are triggered by the editor's own keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) or by dispatching the registered action via `registerAction(...)`. For end-user verification in QA the keyboard event path is the standard contract.
- `updateScene` is the only mutation entry point that accepts `captureUpdate`.

---

## Conclusion of source read

The enum names `IMMEDIATELY` / `NEVER` / `EVENTUALLY` referenced in the plan are **exactly** the names shipped by Excalidraw 0.18.1. The runtime string values match the symbol names 1:1. The enum is exported as a runtime value from the package root.

No fallback (custom undo stack at canvas-store layer) is required.
