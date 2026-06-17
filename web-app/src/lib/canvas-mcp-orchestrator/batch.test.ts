/**
 * Tests for `createBatchController` — the AI-batch undo-grouping helper
 * (Wave 4, T17).
 *
 * The contract under test (verbatim from plan §1733 + spike T3):
 *   - `begin()` returns an opaque `BatchToken`. Nested `begin()` while in
 *     flight returns the EXISTING token + logs warning (no nesting in v1).
 *   - `applyDuringBatch(elements)` calls `excalidrawAPI.updateScene` with
 *     `captureUpdate: 'NEVER'` and accumulates the element-set as
 *     lastKnownGoodState (sticky-on-failure).
 *   - `end(token)` validates the token; mismatched tokens are no-op + warn.
 *     Matched tokens commit ONE history entry via
 *     `updateScene({ elements: lastKnownGoodState, captureUpdate: 'IMMEDIATELY' })`.
 *   - `forceEnd()` is the zombie-recovery drain: while in flight, commits
 *     with lastKnownGoodState; while idle is a safe no-op.
 *
 * The factory is structurally DI'd (no `@excalidraw/excalidraw` runtime
 * import) so the orchestrator dir's "no React/zustand/Excalidraw at module
 * load" invariant keeps passing.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createBatchController,
  CAPTURE_UPDATE,
  type BatchControllerDeps,
  type ExcalidrawApiLike,
} from './batch'
import type { BatchToken } from './index'
import type { ExcalidrawElementLike } from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeApi(updateSceneImpl?: (args: unknown) => void): {
  api: ExcalidrawApiLike
  updateScene: ReturnType<typeof vi.fn>
} {
  const updateScene = vi.fn(updateSceneImpl ?? (() => {}))
  return {
    api: { updateScene } as unknown as ExcalidrawApiLike,
    updateScene,
  }
}

function makeLogger(): {
  logger: NonNullable<BatchControllerDeps['logger']>
  warn: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
} {
  const warn = vi.fn()
  const debug = vi.fn()
  return { logger: { warn, debug }, warn, debug }
}

function makeTelemetry(): {
  telemetry: NonNullable<BatchControllerDeps['telemetry']>
  increment: ReturnType<typeof vi.fn>
} {
  const increment = vi.fn()
  return { telemetry: { increment }, increment }
}

let tokenSeq = 0
function makeTokenFactory(): () => BatchToken {
  return () =>
    Symbol(`batch-${++tokenSeq}`) as unknown as BatchToken
}

function el(id: string): ExcalidrawElementLike {
  return { id, type: 'rectangle' }
}

// ---------------------------------------------------------------------------
// CAPTURE_UPDATE wire-value sanity check (T3 spike contract)
// ---------------------------------------------------------------------------

describe('CAPTURE_UPDATE constant mirror', () => {
  it('exposes the three wire values from the T3 spike', () => {
    expect(CAPTURE_UPDATE.IMMEDIATELY).toBe('IMMEDIATELY')
    expect(CAPTURE_UPDATE.NEVER).toBe('NEVER')
    expect(CAPTURE_UPDATE.EVENTUALLY).toBe('EVENTUALLY')
  })
})

// ---------------------------------------------------------------------------
// begin() / end() — happy path
// ---------------------------------------------------------------------------

describe('createBatchController — begin/end happy path', () => {
  it('begin() returns a token; end(matching) commits exactly one IMMEDIATELY', () => {
    const { api, updateScene } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    const token = c.begin()
    expect(typeof token).toBe('symbol')
    expect(c.isInBatch()).toBe(true)

    // Mid-batch apply (intermediate paint).
    c.applyDuringBatch([el('a')])

    c.end(token)

    expect(c.isInBatch()).toBe(false)
    // 1 NEVER call (intermediate) + 1 IMMEDIATELY commit
    expect(updateScene).toHaveBeenCalledTimes(2)
    const last = updateScene.mock.calls[1][0] as {
      elements: ExcalidrawElementLike[]
      captureUpdate: string
    }
    expect(last.captureUpdate).toBe('IMMEDIATELY')
    expect(last.elements).toEqual([el('a')])
  })

  it('3 dispatched applyDuringBatch calls within batch → exactly 1 IMMEDIATELY after end()', () => {
    const { api, updateScene } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    const token = c.begin()
    c.applyDuringBatch([el('a')])
    c.applyDuringBatch([el('a'), el('b')])
    c.applyDuringBatch([el('a'), el('b'), el('c')])
    c.end(token)

    // Tally captureUpdate values.
    const captures = updateScene.mock.calls.map(
      (args) => (args[0] as { captureUpdate: string }).captureUpdate,
    )
    expect(captures.filter((v) => v === 'NEVER')).toHaveLength(3)
    expect(captures.filter((v) => v === 'IMMEDIATELY')).toHaveLength(1)
    // Final IMMEDIATELY carries the last-known-good state (3 elements).
    const final = updateScene.mock.calls.at(-1)![0] as {
      elements: ExcalidrawElementLike[]
    }
    expect(final.elements).toEqual([el('a'), el('b'), el('c')])
  })

  it('end() with no applyDuringBatch still commits with empty lastKnownGoodState', () => {
    const { api, updateScene } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    const token = c.begin()
    c.end(token)

    expect(updateScene).toHaveBeenCalledTimes(1)
    const args = updateScene.mock.calls[0][0] as {
      elements: ExcalidrawElementLike[]
      captureUpdate: string
    }
    expect(args.captureUpdate).toBe('IMMEDIATELY')
    expect(args.elements).toEqual([])
  })

  it('isInBatch() reflects state across the lifecycle', () => {
    const { api } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    expect(c.isInBatch()).toBe(false)
    const token = c.begin()
    expect(c.isInBatch()).toBe(true)
    c.applyDuringBatch([el('x')])
    expect(c.isInBatch()).toBe(true)
    c.end(token)
    expect(c.isInBatch()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Concurrency — nested begin rejection
// ---------------------------------------------------------------------------

describe('createBatchController — nested begin rejected', () => {
  it('returns the EXISTING token + logs warning when begin() called twice', () => {
    const { api } = makeApi()
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    const t1 = c.begin()
    const t2 = c.begin()
    expect(t2).toBe(t1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.nested_begin'),
    )
  })

  it('does not allocate new state when nested', () => {
    const { api, updateScene } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    const t1 = c.begin()
    c.applyDuringBatch([el('a')])
    const t2 = c.begin()
    expect(t1).toBe(t2)
    c.end(t1)

    // Still ONE IMMEDIATELY at the end; nested begin produced no extra writes.
    const captures = updateScene.mock.calls.map(
      (args) => (args[0] as { captureUpdate: string }).captureUpdate,
    )
    expect(captures.filter((v) => v === 'IMMEDIATELY')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// end() error paths
// ---------------------------------------------------------------------------

describe('createBatchController — end() error paths', () => {
  it('end() without matching begin → no-op + warn', () => {
    const { api, updateScene } = makeApi()
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    const fakeToken = Symbol('fake') as unknown as BatchToken
    c.end(fakeToken)

    expect(updateScene).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.end_without_begin'),
    )
    expect(c.isInBatch()).toBe(false)
  })

  it('end() with WRONG token while in flight → no-op + warn (batch still open)', () => {
    const { api, updateScene } = makeApi()
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    const realToken = c.begin()
    const wrongToken = Symbol('wrong') as unknown as BatchToken
    c.end(wrongToken)

    expect(updateScene).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.end_token_mismatch'),
    )
    // Real batch still in flight.
    expect(c.isInBatch()).toBe(true)

    // Still recoverable via the real token.
    c.end(realToken)
    expect(updateScene).toHaveBeenCalledTimes(1)
    expect(c.isInBatch()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Failure handling — zombie recovery
// ---------------------------------------------------------------------------

describe('createBatchController — zombie recovery', () => {
  it('applyDuringBatch error does NOT abort batch; end() still commits with lastKnownGoodState', () => {
    let throwOnce = true
    const updateScene = vi.fn((args: unknown) => {
      const a = args as { captureUpdate: string }
      if (throwOnce && a.captureUpdate === 'NEVER') {
        throwOnce = false
        throw new Error('excalidraw boom')
      }
    })
    const api = { updateScene } as unknown as ExcalidrawApiLike
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    const token = c.begin()

    // First apply throws but is swallowed; batch state preserved.
    expect(() => c.applyDuringBatch([el('a')])).not.toThrow()
    expect(c.isInBatch()).toBe(true)
    expect(warn).toHaveBeenCalled()
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.apply_error'),
    )

    // Second apply succeeds — becomes the new lastKnownGoodState.
    c.applyDuringBatch([el('a'), el('b')])

    c.end(token)

    // Final commit must happen with the last known good state.
    const lastCall = updateScene.mock.calls.at(-1)![0] as {
      elements: ExcalidrawElementLike[]
      captureUpdate: string
    }
    expect(lastCall.captureUpdate).toBe('IMMEDIATELY')
    expect(lastCall.elements).toEqual([el('a'), el('b')])
    expect(c.isInBatch()).toBe(false)
  })

  it('forceEnd() while in flight commits IMMEDIATELY with lastKnownGoodState', () => {
    const { api, updateScene } = makeApi()
    const { logger, warn } = makeLogger()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      generateBatchToken: makeTokenFactory(),
    })

    c.begin()
    c.applyDuringBatch([el('z')])
    c.forceEnd()

    expect(c.isInBatch()).toBe(false)
    const final = updateScene.mock.calls.at(-1)![0] as {
      elements: ExcalidrawElementLike[]
      captureUpdate: string
    }
    expect(final.captureUpdate).toBe('IMMEDIATELY')
    expect(final.elements).toEqual([el('z')])
    expect(warn).toHaveBeenCalled() // emergency drain logs warning
  })

  it('forceEnd() while idle is a safe no-op', () => {
    const { api, updateScene } = makeApi()
    const c = createBatchController({
      excalidrawAPI: api,
      generateBatchToken: makeTokenFactory(),
    })

    expect(() => c.forceEnd()).not.toThrow()
    expect(updateScene).not.toHaveBeenCalled()
    expect(c.isInBatch()).toBe(false)
  })

  it('forceEnd() also recovers when the IMMEDIATELY commit itself throws', () => {
    const updateScene = vi.fn((args: unknown) => {
      const a = args as { captureUpdate: string }
      if (a.captureUpdate === 'IMMEDIATELY') {
        throw new Error('commit boom')
      }
    })
    const api = { updateScene } as unknown as ExcalidrawApiLike
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: api,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    c.begin()
    c.applyDuringBatch([el('q')])
    expect(() => c.forceEnd()).not.toThrow()
    expect(c.isInBatch()).toBe(false) // state cleared even on commit failure
    expect(warn).toHaveBeenCalled()
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.commit_error'),
    )
  })
})

// ---------------------------------------------------------------------------
// Missing API — fail-closed semantics
// ---------------------------------------------------------------------------

describe('createBatchController — missing excalidrawAPI fail-closed', () => {
  it('begin/end/applyDuringBatch are safe no-ops + log warning when API absent', () => {
    const { logger, warn } = makeLogger()
    const { telemetry, increment } = makeTelemetry()
    const c = createBatchController({
      excalidrawAPI: undefined,
      logger,
      telemetry,
      generateBatchToken: makeTokenFactory(),
    })

    const token = c.begin()
    expect(typeof token).toBe('symbol') // still allocated to keep call sites simple
    expect(() => c.applyDuringBatch([el('a')])).not.toThrow()
    expect(() => c.end(token)).not.toThrow()
    expect(c.isInBatch()).toBe(false)
    expect(warn).toHaveBeenCalled()
    expect(increment).toHaveBeenCalledWith(
      expect.stringContaining('batch.api_missing'),
    )
  })
})
