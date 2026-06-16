/**
 * useExcalidrawTheme — narrows the app's theme state down to Excalidraw's
 * `'light' | 'dark'` contract.
 *
 * Despite T13's spec language referencing `next-themes`, this repo does NOT
 * actually consume `next-themes` (the package is in `package.json` but no
 * source file imports from it). The canonical theme source is the in-house
 * Zustand store at `@/hooks/useTheme`, which exposes:
 *   - `activeTheme`: `'auto' | 'light' | 'dark'`  (user intent)
 *   - `isDark`:      `boolean`                    (resolved value, kept in
 *                                                  sync with OS by
 *                                                  `ThemeProvider`)
 *
 * `ThemeProvider` already wires the `matchMedia('(prefers-color-scheme:
 * dark)')` subscription (and the Tauri `theme-changed` portal event on
 * Linux) to update `isDark` whenever the OS theme flips while
 * `activeTheme === 'auto'`. So all this hook needs to do is read `isDark`
 * — the live update story is handled upstream and Zustand re-renders any
 * subscriber on change.
 *
 * Returns Excalidraw's expected `'light' | 'dark'` literal, never the
 * 'system'/'auto' tri-state. No flicker on first render: `isDark` is
 * initialized synchronously from `checkOSDarkMode()` inside the store.
 */
import { useTheme } from '@/hooks/useTheme'

export type ExcalidrawTheme = 'light' | 'dark'

export function useExcalidrawTheme(): ExcalidrawTheme {
  const isDark = useTheme((state) => state.isDark)
  return isDark ? 'dark' : 'light'
}
