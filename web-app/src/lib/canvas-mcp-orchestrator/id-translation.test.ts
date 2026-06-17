/**
 * Tests for the bidirectional mcp ↔ canvas-store id translator (T16).
 *
 * Uses a deterministic counter as `generateId` so we can assert exact id
 * shapes — the real implementation in canvas-store.ts uses `crypto.randomUUID`
 * which is non-deterministic. The translator is generator-agnostic (DI), so
 * any factory that produces unique strings is acceptable in tests.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createIdTranslator,
  MCP_ID_PREFIX,
  type IdTranslator,
} from './id-translation'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Deterministic id factory for assertion stability. Returns `canvas-1`,
 * `canvas-2`, ... in call order.
 */
function makeCounter(): { gen: () => string; calls: () => number } {
  let n = 0
  return {
    gen: () => `canvas-${++n}`,
    calls: () => n,
  }
}

function makeTranslator(): {
  translator: IdTranslator
  counter: ReturnType<typeof makeCounter>
} {
  const counter = makeCounter()
  return { translator: createIdTranslator({ generateId: counter.gen }), counter }
}

// ---------------------------------------------------------------------------
// translateMcpToCanvas — allocation + idempotency
// ---------------------------------------------------------------------------

describe('createIdTranslator — translateMcpToCanvas', () => {
  it('allocates a new canvas id on first call', () => {
    const { translator } = makeTranslator()
    expect(translator.translateMcpToCanvas('abc')).toBe('canvas-1')
  })

  it('returns the same canvas id on repeat calls with the same mcp id (idempotency)', () => {
    const { translator, counter } = makeTranslator()
    const first = translator.translateMcpToCanvas('abc')
    const second = translator.translateMcpToCanvas('abc')
    const third = translator.translateMcpToCanvas('abc')
    expect(first).toBe(second)
    expect(second).toBe(third)
    // generator must have been called exactly once.
    expect(counter.calls()).toBe(1)
  })

  it('allocates distinct canvas ids for distinct mcp ids', () => {
    const { translator } = makeTranslator()
    const a = translator.translateMcpToCanvas('mcp-a')
    const b = translator.translateMcpToCanvas('mcp-b')
    expect(a).not.toBe(b)
    expect(a).toBe('canvas-1')
    expect(b).toBe('canvas-2')
  })
})

// ---------------------------------------------------------------------------
// translateCanvasToMcp — reverse lookup
// ---------------------------------------------------------------------------

describe('createIdTranslator — translateCanvasToMcp (reverse)', () => {
  it('returns the original mcp id after a forward translation', () => {
    const { translator } = makeTranslator()
    const canvasId = translator.translateMcpToCanvas('abc')
    expect(translator.translateCanvasToMcp(canvasId)).toBe('abc')
  })

  it('returns undefined for an unregistered canvas id', () => {
    const { translator } = makeTranslator()
    expect(translator.translateCanvasToMcp('unknown-id')).toBeUndefined()
  })

  it('is bidirectional after two distinct allocations', () => {
    const { translator } = makeTranslator()
    const ca = translator.translateMcpToCanvas('mcp-a')
    const cb = translator.translateMcpToCanvas('mcp-b')
    expect(translator.translateCanvasToMcp(ca)).toBe('mcp-a')
    expect(translator.translateCanvasToMcp(cb)).toBe('mcp-b')
  })
})

// ---------------------------------------------------------------------------
// registerUserElement — identity mapping
// ---------------------------------------------------------------------------

describe('createIdTranslator — registerUserElement', () => {
  it('makes a user-created canvas id reverse-translatable as identity', () => {
    const { translator } = makeTranslator()
    translator.registerUserElement('canvas-z')
    // Reverse: canvas 'canvas-z' → mcp 'canvas-z' (identity)
    expect(translator.translateCanvasToMcp('canvas-z')).toBe('canvas-z')
  })

  it('registering the same canvas id twice is idempotent (no allocator call)', () => {
    const { translator, counter } = makeTranslator()
    translator.registerUserElement('canvas-z')
    translator.registerUserElement('canvas-z')
    expect(counter.calls()).toBe(0) // identity mapping does not allocate.
    expect(translator.size()).toBe(1)
  })

  it('does not allocate via generateId (identity mapping)', () => {
    const { translator, counter } = makeTranslator()
    translator.registerUserElement('canvas-z')
    expect(counter.calls()).toBe(0)
  })

  it('does NOT short-circuit forward translation — namespacing is preserved', () => {
    // This is the collision-avoidance contract: registering a user element
    // with id 'x' must NOT make `translateMcpToCanvas('x')` return 'x'.
    // The mcp id namespace and the canvas id namespace are kept separate
    // (see plan §1666 — "namespace mcp ids internally with prefix `mcp_`").
    const { translator } = makeTranslator()
    translator.registerUserElement('x')
    expect(translator.translateMcpToCanvas('x')).not.toBe('x')
    expect(translator.translateMcpToCanvas('x')).toBe('canvas-1')
  })
})

// ---------------------------------------------------------------------------
// mcp_ namespacing — collision avoidance
// ---------------------------------------------------------------------------

describe('createIdTranslator — mcp_ namespacing', () => {
  it('namespaces mcp ids internally so they cannot collide with canvas ids', () => {
    const { translator } = makeTranslator()
    // User registers a canvas id that happens to equal the raw mcp id 'x'.
    translator.registerUserElement('x')
    // Now MCP returns an element whose id is also 'x' — these are DIFFERENT
    // logical ids and must map to different canvas store ids.
    const fromMcp = translator.translateMcpToCanvas('x')
    expect(fromMcp).not.toBe('x') // collision avoided.
    expect(fromMcp).toBe('canvas-1')

    // Reverse lookups stay correctly bucketed.
    expect(translator.translateCanvasToMcp('x')).toBe('x') // user identity.
    expect(translator.translateCanvasToMcp('canvas-1')).toBe('x') // mcp source.
  })

  it('exposes MCP_ID_PREFIX as a constant (for documentation + tests)', () => {
    expect(MCP_ID_PREFIX).toBe('mcp_')
  })

  it('callers never see the mcp_ prefix in returned canvas ids', () => {
    const { translator } = makeTranslator()
    const canvasId = translator.translateMcpToCanvas('xyz')
    expect(canvasId.startsWith(MCP_ID_PREFIX)).toBe(false)
  })

  it('callers never see the mcp_ prefix in reverse-translated mcp ids', () => {
    const { translator } = makeTranslator()
    const canvasId = translator.translateMcpToCanvas('xyz')
    expect(translator.translateCanvasToMcp(canvasId)).toBe('xyz')
    expect(translator.translateCanvasToMcp(canvasId)?.startsWith(MCP_ID_PREFIX)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clear() — session boundary reset
// ---------------------------------------------------------------------------

describe('createIdTranslator — clear', () => {
  it('empties both directions of the map', () => {
    const { translator } = makeTranslator()
    const ca = translator.translateMcpToCanvas('a')
    translator.registerUserElement('user-b')
    expect(translator.size()).toBe(2)

    translator.clear()
    expect(translator.size()).toBe(0)
    expect(translator.translateCanvasToMcp(ca)).toBeUndefined()
    expect(translator.translateCanvasToMcp('user-b')).toBeUndefined()
  })

  it('allows re-allocation after clear (fresh allocations)', () => {
    const { translator, counter } = makeTranslator()
    translator.translateMcpToCanvas('a') // → canvas-1
    translator.clear()
    const reallocated = translator.translateMcpToCanvas('a') // → canvas-2 (fresh)
    expect(reallocated).toBe('canvas-2')
    expect(counter.calls()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// size() — observability
// ---------------------------------------------------------------------------

describe('createIdTranslator — size', () => {
  it('starts at zero', () => {
    const { translator } = makeTranslator()
    expect(translator.size()).toBe(0)
  })

  it('reflects unique-key count (not call count)', () => {
    const { translator } = makeTranslator()
    translator.translateMcpToCanvas('a')
    translator.translateMcpToCanvas('a') // dup — does not grow size.
    translator.translateMcpToCanvas('b')
    translator.registerUserElement('user-c')
    expect(translator.size()).toBe(3) // a, b, user-c
  })
})

// ---------------------------------------------------------------------------
// Round-trip QA scenario (mirrors plan §1712)
// ---------------------------------------------------------------------------

describe('createIdTranslator — round-trip QA scenario', () => {
  it('round-trip translation is consistent', () => {
    const { translator } = makeTranslator()
    // 1. translate mcpId 'mcp_abc' → get canvas id X
    const x = translator.translateMcpToCanvas('mcp_abc')
    // 2. translate mcpId 'mcp_abc' again → must equal X
    expect(translator.translateMcpToCanvas('mcp_abc')).toBe(x)
    // 3. translate mcpId 'mcp_xyz' → get canvas id Y ≠ X
    const y = translator.translateMcpToCanvas('mcp_xyz')
    expect(y).not.toBe(x)
    // 4. reverseTranslate canvas id X → must equal 'mcp_abc'
    expect(translator.translateCanvasToMcp(x)).toBe('mcp_abc')
    expect(translator.translateCanvasToMcp(y)).toBe('mcp_xyz')
  })
})

// ---------------------------------------------------------------------------
// Generator contract
// ---------------------------------------------------------------------------

describe('createIdTranslator — generator', () => {
  it('uses the injected generateId on each fresh allocation', () => {
    const gen = vi.fn(() => 'g')
    // The generator must produce unique ids for real use; here we accept the
    // duplicate to assert the call surface only.
    const translator = createIdTranslator({ generateId: gen })
    translator.translateMcpToCanvas('a')
    expect(gen).toHaveBeenCalledTimes(1)
  })
})
