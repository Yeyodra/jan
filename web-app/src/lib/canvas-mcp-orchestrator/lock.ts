/**
 * Manual-edit lock controller (Wave 5, T22)
 * ============================================
 *
 * Pure-DI helper consumed by `CanvasMcpOrchestrator.lockManualEdits` /
 * `isManualEditLocked` / `subscribeManualEditLock` and ultimately by the
 * canvas page's `CanvasManualEditLockBanner` + Excalidraw `viewModeEnabled`
 * wiring (the wiring itself lands in T20).
 *
 * Contract (verbatim from plan §2181-2229):
 *
 *   1. `lock()` returns an idempotent `unlockFn`. The lock is
 *      reference-counted: every `lock()` call increments; the returned
 *      `unlockFn` decrements ON THE FIRST CALL and is a safe no-op on
 *      subsequent calls. RefCount cannot go negative even from spurious
 *      double-unlock.
 *
 *   2. `isLocked() === refCount > 0`. The locked-flag is a derived value;
 *      consumers that only care about visibility can read this directly.
 *
 *   3. Observer pattern (`onChange`): subscribers are notified on every
 *      refCount change (including the lock→lock transition that doesn't
 *      flip `isLocked`). Consumer chooses whether to ignore refCount-only
 *      changes. `onChange` returns an unsubscribe fn — symmetric with
 *      zustand's `subscribe()` shape, no React or zustand import needed.
 *
 *   4. `forceUnlock()` is the emergency drain. Resets refCount to 0 and
 *      notifies observers exactly once (only when refCount was non-zero).
 *      Used by:
 *        - `endAiBatch` — auto-unlock per plan §2186-2187
 *        - Orchestrator state transitions to `'idle'` / `'error'`
 *        - Zombie-batch recovery on unmount / process crash.
 *      Previously-issued unlockFns become inert after `forceUnlock` — they
 *      check the per-call epoch token and bail when it doesn't match.
 *
 *   5. Per-canvas only: each `CanvasMcpOrchestrator` instance owns one
 *      controller (factory: `createLockController(deps?)`). Locking on
 *      canvas A does not affect canvas B's controller. Plan §2188.
 *
 * Style alignment
 * ---------------
 * Mirrors the structural-DI factory pattern from `./active-canvas.ts` (T14),
 * `./dispatch.ts` (T15), `./id-translation.ts` (T16), `./batch.ts` (T17):
 *   - Pure factory `createLockController(deps?): LockController`
 *   - Closure-encapsulated state
 *   - Optional logger; observer errors are caught + logged so a misbehaving
 *     subscriber cannot brick the controller
 *   - NO `react`, NO `zustand`, NO `@excalidraw/excalidraw` imports at
 *     module top-level. Asserted by `lock.test.ts` and the
 *     orchestrator's `index.test.ts` "does not import React, zustand, or
 *     Excalidraw at module load" invariant.
 *
 * @see web-app/src/lib/canvas-mcp-orchestrator/index.ts (consumer)
 * @see web-app/src/components/canvas/CanvasManualEditLockBanner.tsx (UI)
 */

import type { SyncLogger } from './active-canvas'

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Decrements the lock's refCount. Idempotent — safe to call multiple times;
 * only the FIRST call (per matching epoch) actually decrements. Becomes
 * inert after `forceUnlock` resets the controller.
 */
export type UnlockFn = () => void

/**
 * Lock observer signature. Receives the current `locked` flag and the
 * full refCount. Fires on every refCount change (including stack pushes
 * that don't flip `locked`). Consumers may ignore refCount-only changes.
 *
 * Observers MUST NOT throw — but if they do, the controller catches the
 * error and continues fanning out to the remaining subscribers.
 */
export type LockObserver = (locked: boolean, refCount: number) => void

/**
 * Public API of one lock controller. One instance per orchestrator.
 */
export type LockController = {
  /** Increment refCount; return an idempotent unlock fn. */
  lock: () => UnlockFn
  /** Convenience predicate; equivalent to `getRefCount() > 0`. */
  isLocked: () => boolean
  /** Current outstanding lock count. Useful for telemetry / diagnostics. */
  getRefCount: () => number
  /**
   * Subscribe to refCount changes. Returns an unsubscribe fn — symmetric
   * with zustand's `subscribe()` so React adapters (e.g. via
   * `useSyncExternalStore`) can wire it without ceremony.
   */
  onChange: (observer: LockObserver) => () => void
  /**
   * Emergency drain. Resets refCount to 0 and notifies observers ONCE
   * (only when refCount was non-zero). All previously-issued unlockFns
   * become inert. Used for:
   *   - `endAiBatch` auto-unlock
   *   - orchestrator state transition to `'idle'` / `'error'`
   *   - zombie-batch recovery on unmount / process crash.
   */
  forceUnlock: () => void
}

/**
 * Optional dependencies. All slots default to noop so the controller is
 * trivially constructable in tests.
 */
export type LockControllerDeps = {
  /**
   * Logger contract reused from `./active-canvas` so the orchestrator's
   * DI ergonomics stay consistent. We only use `warn` here (when an
   * observer throws); the `debug` channel stays available for future
   * diagnostics without shape churn.
   */
  logger?: SyncLogger
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a fresh `LockController`. Closure-encapsulated state so every
 * orchestrator instance owns its own lock lifecycle (per-canvas only —
 * plan §2188).
 */
export function createLockController(
  deps: LockControllerDeps = {},
): LockController {
  const { logger } = deps

  // ----- closure state ------------------------------------------------------
  let refCount = 0
  /**
   * Monotonically-incrementing token. `forceUnlock` bumps this so any
   * outstanding unlockFns from a previous epoch become inert (their
   * captured `epochAtLock` won't match the current `epoch`).
   */
  let epoch = 0
  const observers = new Set<LockObserver>()

  // ----- helpers ------------------------------------------------------------
  const warn = (msg: string, meta?: Record<string, unknown>): void => {
    logger?.warn?.(msg, meta)
  }

  /**
   * Fan-out to subscribed observers. A throwing observer is caught and
   * logged so it cannot prevent its peers from being notified. We snapshot
   * the set with `Array.from` so an observer that unsubscribes itself
   * during fan-out doesn't desync the iterator.
   */
  const notify = (): void => {
    const locked = refCount > 0
    const snapshot = Array.from(observers)
    for (const observer of snapshot) {
      try {
        observer(locked, refCount)
      } catch (err) {
        warn('canvas-mcp-orchestrator: lock observer threw; continuing', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // ----- public methods -----------------------------------------------------
  const lock: LockController['lock'] = () => {
    refCount += 1
    notify()

    // Capture the epoch at lock-acquisition time so this unlockFn becomes
    // inert if `forceUnlock` bumps the epoch mid-flight.
    const epochAtLock = epoch
    let consumed = false

    const unlockFn: UnlockFn = () => {
      // Idempotency: only the FIRST call (per matching epoch) decrements.
      if (consumed) return
      // Stale-epoch guard: a `forceUnlock` since this lock was issued
      // already drained refCount; this unlockFn is a no-op now.
      if (epochAtLock !== epoch) {
        consumed = true
        return
      }
      consumed = true
      // Defence-in-depth: refCount cannot go negative under any
      // circumstance. Without this guard a fully-drained controller +
      // a re-fired unlockFn from before forceUnlock could underflow.
      if (refCount <= 0) {
        return
      }
      refCount -= 1
      notify()
    }

    return unlockFn
  }

  const isLocked: LockController['isLocked'] = () => refCount > 0
  const getRefCount: LockController['getRefCount'] = () => refCount

  const onChange: LockController['onChange'] = (observer) => {
    observers.add(observer)
    return () => {
      observers.delete(observer)
    }
  }

  const forceUnlock: LockController['forceUnlock'] = () => {
    if (refCount === 0) {
      // Already idle — no-op, no notify (observers don't need to learn
      // about a non-event).
      return
    }
    refCount = 0
    // Bump the epoch so previously-issued unlockFns become inert.
    epoch += 1
    notify()
  }

  return {
    lock,
    isLocked,
    getRefCount,
    onChange,
    forceUnlock,
  }
}
