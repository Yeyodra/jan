/**
 * lock.ts — unit tests (T22, Wave 5)
 *
 * Behavior contract under test (plan §2181-2229):
 *   - `lock()` returns an unlock fn; calling unlock restores edit mode
 *     (refCount → 0, locked → false).
 *   - Reference-counted: 3 locks → first 2 unlocks keep `isLocked() === true`;
 *     3rd unlock returns to `false`.
 *   - Idempotent unlock: calling the SAME unlockFn twice does NOT
 *     double-decrement.
 *   - Observer fires on every `lock()` and `unlock()` call (refCount changes).
 *   - `forceUnlock` resets refCount to 0; observer fires once.
 *   - `onChange` returns an unsubscribe function; after unsubscribe the
 *     observer is not called.
 *
 * The exhaustive behaviour matrix lives here. The orchestrator integration
 * tests (`index.test.ts`) only confirm the wire-through.
 */
import { describe, it, expect, vi } from 'vitest'

import { createLockController, type LockObserver } from './lock'

describe('createLockController — basic lock/unlock', () => {
  it('starts unlocked with refCount=0', () => {
    const c = createLockController()
    expect(c.isLocked()).toBe(false)
    expect(c.getRefCount()).toBe(0)
  })

  it('lock() returns an unlock fn; unlock restores edit mode', () => {
    const c = createLockController()
    const unlock = c.lock()
    expect(typeof unlock).toBe('function')
    expect(c.isLocked()).toBe(true)
    expect(c.getRefCount()).toBe(1)

    unlock()
    expect(c.isLocked()).toBe(false)
    expect(c.getRefCount()).toBe(0)
  })
})

describe('createLockController — refcount stacking', () => {
  it('3 locks → first 2 unlocks keep isLocked true; 3rd returns to false', () => {
    const c = createLockController()
    const u1 = c.lock()
    const u2 = c.lock()
    const u3 = c.lock()
    expect(c.getRefCount()).toBe(3)
    expect(c.isLocked()).toBe(true)

    u1()
    expect(c.getRefCount()).toBe(2)
    expect(c.isLocked()).toBe(true)

    u2()
    expect(c.getRefCount()).toBe(1)
    expect(c.isLocked()).toBe(true)

    u3()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
  })

  it('unlock fns can be called in any order (LIFO not required)', () => {
    const c = createLockController()
    const u1 = c.lock()
    const u2 = c.lock()
    // FIFO: drain u1 first, then u2.
    u1()
    expect(c.getRefCount()).toBe(1)
    expect(c.isLocked()).toBe(true)
    u2()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
  })
})

describe('createLockController — idempotent unlock', () => {
  it('calling the same unlockFn twice does NOT double-decrement', () => {
    const c = createLockController()
    const u1 = c.lock()
    const u2 = c.lock()
    expect(c.getRefCount()).toBe(2)

    u1()
    expect(c.getRefCount()).toBe(1)
    // Second call to the SAME unlockFn must be a safe no-op.
    u1()
    expect(c.getRefCount()).toBe(1)
    expect(c.isLocked()).toBe(true)

    u2()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)

    // Even fully drained, calling u1 again must not push refCount negative.
    u1()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
  })

  it('refCount cannot go negative even from many spurious unlock calls', () => {
    const c = createLockController()
    const u = c.lock()
    u()
    u()
    u()
    u()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
  })
})

describe('createLockController — observer pattern', () => {
  it('observer fires on every lock() and unlock() call', () => {
    const c = createLockController()
    const observer = vi.fn<LockObserver>()
    c.onChange(observer)

    const u1 = c.lock() // 1st event: locked=true, refCount=1
    const u2 = c.lock() // 2nd event: locked=true, refCount=2
    u1() //               3rd event: locked=true, refCount=1
    u2() //               4th event: locked=false, refCount=0

    expect(observer).toHaveBeenCalledTimes(4)
    expect(observer.mock.calls[0]).toEqual([true, 1])
    expect(observer.mock.calls[1]).toEqual([true, 2])
    expect(observer.mock.calls[2]).toEqual([true, 1])
    expect(observer.mock.calls[3]).toEqual([false, 0])
  })

  it('multiple observers all receive the same events', () => {
    const c = createLockController()
    const a = vi.fn<LockObserver>()
    const b = vi.fn<LockObserver>()
    c.onChange(a)
    c.onChange(b)

    const u = c.lock()
    u()

    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(2)
    expect(a.mock.calls).toEqual(b.mock.calls)
  })

  it('idempotent unlock does NOT fire the observer the second time', () => {
    const c = createLockController()
    const observer = vi.fn<LockObserver>()
    c.onChange(observer)

    const u = c.lock() // event 1
    u() // event 2
    u() // no-op — must NOT fire
    u() // no-op — must NOT fire

    expect(observer).toHaveBeenCalledTimes(2)
  })

  it('onChange returns an unsubscribe function; after unsubscribe observer is not called', () => {
    const c = createLockController()
    const observer = vi.fn<LockObserver>()
    const unsubscribe = c.onChange(observer)

    const u = c.lock()
    expect(observer).toHaveBeenCalledTimes(1)

    unsubscribe()
    u()
    expect(observer).toHaveBeenCalledTimes(1) // not called again
  })

  it('an observer that throws does NOT break the controller', () => {
    const c = createLockController({
      logger: { warn: vi.fn(), debug: vi.fn() },
    })
    const bad = vi.fn(() => {
      throw new Error('observer boom')
    })
    const good = vi.fn<LockObserver>()
    c.onChange(bad)
    c.onChange(good)

    const u = c.lock()
    // Both observers were attempted; controller didn't bail mid-fan-out.
    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    expect(c.isLocked()).toBe(true)
    expect(c.getRefCount()).toBe(1)

    u()
    expect(c.isLocked()).toBe(false)
  })
})

describe('createLockController — forceUnlock (zombie-batch recovery)', () => {
  it('resets refCount to 0 and notifies observers exactly once', () => {
    const c = createLockController()
    const observer = vi.fn<LockObserver>()
    c.onChange(observer)

    c.lock()
    c.lock()
    c.lock()
    expect(c.getRefCount()).toBe(3)
    observer.mockClear()

    c.forceUnlock()

    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
    expect(observer).toHaveBeenCalledTimes(1)
    expect(observer).toHaveBeenCalledWith(false, 0)
  })

  it('forceUnlock when already idle is a safe no-op (no observer fire)', () => {
    const c = createLockController()
    const observer = vi.fn<LockObserver>()
    c.onChange(observer)

    c.forceUnlock()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
    expect(observer).not.toHaveBeenCalled()
  })

  it('previously-issued unlockFns are inert after forceUnlock', () => {
    const c = createLockController()
    const u1 = c.lock()
    const u2 = c.lock()
    c.forceUnlock()
    expect(c.getRefCount()).toBe(0)

    // Stale unlockFns must not push refCount negative or flip state.
    u1()
    u2()
    expect(c.getRefCount()).toBe(0)
    expect(c.isLocked()).toBe(false)
  })
})

describe('createLockController — module hygiene', () => {
  it('does not import React, zustand, or @excalidraw/excalidraw at module load', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, 'lock.ts'), 'utf8')
    const forbidden = [
      "from 'react'",
      'from "react"',
      "from 'zustand'",
      'from "zustand"',
      "from '@excalidraw/excalidraw'",
      'from "@excalidraw/excalidraw"',
    ]
    for (const f of forbidden) {
      expect(src).not.toContain(f)
    }
  })
})
