import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MCPTool } from '@janhq/core'
import {
  EXCALIDRAW_ALLOWED_TOOLS,
  EXCALIDRAW_BLOCKED_TOOLS,
  EXCALIDRAW_MUTATING_TOOLS,
  EXCALIDRAW_READONLY_TOOLS,
  filterAllowedTools,
  requiresApproval,
} from './curated-tools'

// ---------------------------------------------------------------------------
// Canonical 26-tool source list (T2 spike) — loaded from evidence JSON.
// ---------------------------------------------------------------------------

const CANONICAL_PATH = resolve(
  __dirname,
  '../../../../.sisyphus/evidence/task-2-bun-tools-list.json',
)

function loadCanonicalToolNames(): string[] {
  const raw = readFileSync(CANONICAL_PATH, 'utf8').replace(/^\uFEFF/, '')
  const json = JSON.parse(raw) as { tools: Array<{ name: string }> }
  return json.tools.map((t) => t.name)
}

const CANONICAL_TOOL_NAMES = loadCanonicalToolNames()

// Helper: build a fake MCPTool object for a given name.
function fakeTool(name: string): MCPTool {
  return {
    name,
    description: `fake description for ${name}`,
    inputSchema: { type: 'object', properties: {} },
  } as unknown as MCPTool
}

describe('curated-tools — set invariants', () => {
  it('EXCALIDRAW_ALLOWED_TOOLS has exactly 24 entries', () => {
    expect(EXCALIDRAW_ALLOWED_TOOLS.size).toBe(24)
  })

  it('EXCALIDRAW_BLOCKED_TOOLS has exactly 2 entries', () => {
    expect(EXCALIDRAW_BLOCKED_TOOLS.size).toBe(2)
  })

  it('|allowed| + |blocked| === 26 (canonical tools/list count)', () => {
    expect(EXCALIDRAW_ALLOWED_TOOLS.size + EXCALIDRAW_BLOCKED_TOOLS.size).toBe(
      26,
    )
  })

  it('allowed ∩ blocked === ∅', () => {
    const overlap = [...EXCALIDRAW_ALLOWED_TOOLS].filter((n) =>
      EXCALIDRAW_BLOCKED_TOOLS.has(n),
    )
    expect(overlap).toEqual([])
  })

  it('mutating ⊂ allowed', () => {
    const missing = [...EXCALIDRAW_MUTATING_TOOLS].filter(
      (n) => !EXCALIDRAW_ALLOWED_TOOLS.has(n),
    )
    expect(missing).toEqual([])
  })

  it('readonly ⊂ allowed', () => {
    const missing = [...EXCALIDRAW_READONLY_TOOLS].filter(
      (n) => !EXCALIDRAW_ALLOWED_TOOLS.has(n),
    )
    expect(missing).toEqual([])
  })

  it('mutating ∩ readonly === ∅', () => {
    const overlap = [...EXCALIDRAW_MUTATING_TOOLS].filter((n) =>
      EXCALIDRAW_READONLY_TOOLS.has(n),
    )
    expect(overlap).toEqual([])
  })

  it('|mutating| + |readonly| === |allowed| (partition)', () => {
    expect(
      EXCALIDRAW_MUTATING_TOOLS.size + EXCALIDRAW_READONLY_TOOLS.size,
    ).toBe(EXCALIDRAW_ALLOWED_TOOLS.size)
  })
})

describe('curated-tools — cross-reference vs canonical T2 source list', () => {
  it('canonical source list has exactly 26 tool names', () => {
    expect(CANONICAL_TOOL_NAMES.length).toBe(26)
  })

  it('(allowed ∪ blocked) === canonical 26-name source set', () => {
    const union = new Set<string>([
      ...EXCALIDRAW_ALLOWED_TOOLS,
      ...EXCALIDRAW_BLOCKED_TOOLS,
    ])
    const canonical = new Set<string>(CANONICAL_TOOL_NAMES)

    const missingFromCurated = [...canonical].filter((n) => !union.has(n))
    const extraInCurated = [...union].filter((n) => !canonical.has(n))

    expect(missingFromCurated).toEqual([])
    expect(extraInCurated).toEqual([])
    expect(union.size).toBe(26)
  })
})

describe('curated-tools — filterAllowedTools()', () => {
  // Build input of all 26 canonical tools so we test both directions
  // (24 kept + 2 stripped) in one shot.
  const buildInput = (): MCPTool[] => CANONICAL_TOOL_NAMES.map(fakeTool)

  it('returns exactly 24 entries when given the canonical 26-tool list', () => {
    const out = filterAllowedTools(buildInput())
    expect(out.length).toBe(24)
  })

  it('strips every name in EXCALIDRAW_BLOCKED_TOOLS', () => {
    const out = filterAllowedTools(buildInput())
    const outNames = new Set(out.map((t) => t.name))
    for (const blocked of EXCALIDRAW_BLOCKED_TOOLS) {
      expect(outNames.has(blocked)).toBe(false)
    }
  })

  it('keeps every name in EXCALIDRAW_ALLOWED_TOOLS', () => {
    const out = filterAllowedTools(buildInput())
    const outNames = new Set(out.map((t) => t.name))
    for (const allowed of EXCALIDRAW_ALLOWED_TOOLS) {
      expect(outNames.has(allowed)).toBe(true)
    }
  })

  it('drops unknown tools (closed allow-list, fail-closed)', () => {
    const input = [
      fakeTool('create_element'), // allowed
      fakeTool('totally_made_up_future_tool'), // unknown
      fakeTool('export_to_image'), // blocked
      fakeTool('query_elements'), // allowed
    ]
    const out = filterAllowedTools(input)
    expect(out.map((t) => t.name)).toEqual(['create_element', 'query_elements'])
  })

  it('preserves input order of kept tools', () => {
    // Use a deliberately shuffled subset of allowed tools.
    const ordered = [
      'set_viewport',
      'export_to_image', // blocked — should drop, not reorder
      'create_element',
      'describe_scene',
      'get_canvas_screenshot', // blocked — should drop, not reorder
      'clear_canvas',
    ].map(fakeTool)
    const out = filterAllowedTools(ordered)
    expect(out.map((t) => t.name)).toEqual([
      'set_viewport',
      'create_element',
      'describe_scene',
      'clear_canvas',
    ])
  })

  it('is pure: does not mutate input array length or contents', () => {
    const input = buildInput()
    const originalLength = input.length
    const originalNames = input.map((t) => t.name)
    const originalRefs = [...input]

    filterAllowedTools(input)

    expect(input.length).toBe(originalLength)
    expect(input.map((t) => t.name)).toEqual(originalNames)
    // Element references must be identical (no replacement).
    for (let i = 0; i < input.length; i++) {
      expect(input[i]).toBe(originalRefs[i])
    }
  })

  it('is pure: two invocations with the same input return deep-equal output', () => {
    const input = buildInput()
    const out1 = filterAllowedTools(input)
    const out2 = filterAllowedTools(input)
    expect(out1).toEqual(out2)
    expect(out1.length).toBe(24)
    expect(out2.length).toBe(24)
  })

  it('returns a NEW array (not the same reference as input)', () => {
    const input = buildInput()
    const out = filterAllowedTools(input)
    expect(out).not.toBe(input)
  })

  it('returns an empty array given an empty input', () => {
    expect(filterAllowedTools([])).toEqual([])
  })
})

describe('curated-tools — requiresApproval()', () => {
  it.each([...EXCALIDRAW_MUTATING_TOOLS])(
    "returns true for mutating tool '%s'",
    (name) => {
      expect(requiresApproval(name)).toBe(true)
    },
  )

  it.each([...EXCALIDRAW_READONLY_TOOLS])(
    "returns false for readonly tool '%s'",
    (name) => {
      expect(requiresApproval(name)).toBe(false)
    },
  )

  it('returns false for an unknown tool name (fail-closed lives in the filter, not the gate)', () => {
    expect(requiresApproval('totally_made_up_future_tool')).toBe(false)
  })

  it('returns false for the empty string', () => {
    expect(requiresApproval('')).toBe(false)
  })

  it('returns false for blocked tool names (they should have been filtered out upstream, but the gate is conservative)', () => {
    for (const blocked of EXCALIDRAW_BLOCKED_TOOLS) {
      expect(requiresApproval(blocked)).toBe(false)
    }
  })
})
