/**
 * T28 — schema validation tests for the canvas AI tools (T07).
 *
 * Each top-level `describe` corresponds to one exported zod schema. We use
 * `safeParse` so we can assert on `success` plus the parsed `data` shape
 * without polluting the test runner with thrown errors. Both the happy path
 * (accepted shape) and the failure modes (rejected shape) are covered for
 * every schema the implementation surfaces to the LLM.
 */
import { describe, it, expect } from 'vitest'

import {
  canvasCreateInputSchema,
  canvasCreateOutputSchema,
  canvasDeleteInputSchema,
  canvasDeleteOutputSchema,
  canvasListInputSchema,
  canvasListOutputSchema,
  canvasMetaSchema,
  canvasReadInputSchema,
  canvasReadOutputSchema,
  canvasSceneSchema,
  canvasSchema,
  canvasUpdateInputSchema,
  canvasUpdateOutputSchema,
} from './schemas'

const VALID_UUID = '00000000-0000-4000-8000-000000000000'
const VALID_ISO = '2025-01-01T00:00:00.000Z'

describe('canvasSceneSchema', () => {
  it('accepts a scene with only elements', () => {
    const r = canvasSceneSchema.safeParse({ elements: [] })
    expect(r.success).toBe(true)
  })

  it('accepts a scene with elements + appState + files', () => {
    const r = canvasSceneSchema.safeParse({
      elements: [{ type: 'rect' }],
      appState: { viewBackgroundColor: '#fff' },
      files: { 'fileA': { id: 'fileA' } },
    })
    expect(r.success).toBe(true)
  })

  it('rejects when elements is missing', () => {
    const r = canvasSceneSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('rejects when elements is not an array', () => {
    const r = canvasSceneSchema.safeParse({ elements: 'not-an-array' })
    expect(r.success).toBe(false)
  })
})

describe('canvasMetaSchema', () => {
  it('accepts a fully-formed meta record', () => {
    const r = canvasMetaSchema.safeParse({
      id: VALID_UUID,
      name: 'My Canvas',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a non-UUID id', () => {
    const r = canvasMetaSchema.safeParse({
      id: 'not-a-uuid',
      name: 'X',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })

  it('rejects an empty name', () => {
    const r = canvasMetaSchema.safeParse({
      id: VALID_UUID,
      name: '',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a name longer than 120 chars', () => {
    const r = canvasMetaSchema.safeParse({
      id: VALID_UUID,
      name: 'a'.repeat(121),
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a non-ISO datetime in createdAt', () => {
    const r = canvasMetaSchema.safeParse({
      id: VALID_UUID,
      name: 'X',
      createdAt: 'yesterday',
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })

  it('rejects a non-ISO datetime in updatedAt', () => {
    const r = canvasMetaSchema.safeParse({
      id: VALID_UUID,
      name: 'X',
      createdAt: VALID_ISO,
      updatedAt: 'tomorrow',
    })
    expect(r.success).toBe(false)
  })
})

describe('canvasSchema (full record)', () => {
  it('accepts metadata + scene', () => {
    const r = canvasSchema.safeParse({
      id: VALID_UUID,
      name: 'My Canvas',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
      scene: { elements: [] },
    })
    expect(r.success).toBe(true)
  })

  it('rejects when scene is missing', () => {
    const r = canvasSchema.safeParse({
      id: VALID_UUID,
      name: 'My Canvas',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })
})

describe('canvasListInputSchema', () => {
  it('accepts an empty object', () => {
    const r = canvasListInputSchema.safeParse({})
    expect(r.success).toBe(true)
  })
})

describe('canvasListOutputSchema', () => {
  it('accepts an empty canvases array', () => {
    const r = canvasListOutputSchema.safeParse({ canvases: [] })
    expect(r.success).toBe(true)
  })

  it('accepts a populated canvases array', () => {
    const r = canvasListOutputSchema.safeParse({
      canvases: [
        {
          id: VALID_UUID,
          name: 'X',
          createdAt: VALID_ISO,
          updatedAt: VALID_ISO,
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects a malformed entry', () => {
    const r = canvasListOutputSchema.safeParse({
      canvases: [{ id: 'bad', name: 'X' }],
    })
    expect(r.success).toBe(false)
  })
})

describe('canvasCreateInputSchema', () => {
  it('accepts { name } (scene omitted)', () => {
    const r = canvasCreateInputSchema.safeParse({ name: 'X' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.name).toBe('X')
      expect(r.data.scene).toBeUndefined()
    }
  })

  it('accepts { name, scene: { elements: [] } }', () => {
    const r = canvasCreateInputSchema.safeParse({
      name: 'X',
      scene: { elements: [] },
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing name', () => {
    const r = canvasCreateInputSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('rejects empty name', () => {
    const r = canvasCreateInputSchema.safeParse({ name: '' })
    expect(r.success).toBe(false)
  })

  it('rejects name >120 chars', () => {
    const r = canvasCreateInputSchema.safeParse({ name: 'a'.repeat(121) })
    expect(r.success).toBe(false)
  })

  it('rejects non-string name', () => {
    const r = canvasCreateInputSchema.safeParse({ name: 42 })
    expect(r.success).toBe(false)
  })
})

describe('canvasCreateOutputSchema', () => {
  it('accepts a well-formed create response', () => {
    const r = canvasCreateOutputSchema.safeParse({
      id: VALID_UUID,
      name: 'X',
      createdAt: VALID_ISO,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a non-UUID id in the response', () => {
    const r = canvasCreateOutputSchema.safeParse({
      id: 'not-a-uuid',
      name: 'X',
      createdAt: VALID_ISO,
    })
    expect(r.success).toBe(false)
  })
})

describe('canvasReadInputSchema', () => {
  it('accepts { id: <uuid> }', () => {
    const r = canvasReadInputSchema.safeParse({ id: VALID_UUID })
    expect(r.success).toBe(true)
  })

  it('rejects a non-UUID id', () => {
    const r = canvasReadInputSchema.safeParse({ id: 'not-a-uuid' })
    expect(r.success).toBe(false)
  })

  it('rejects when id is missing', () => {
    const r = canvasReadInputSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('canvasReadOutputSchema', () => {
  it('accepts a full canvas record', () => {
    const r = canvasReadOutputSchema.safeParse({
      id: VALID_UUID,
      name: 'X',
      createdAt: VALID_ISO,
      updatedAt: VALID_ISO,
      scene: { elements: [] },
    })
    expect(r.success).toBe(true)
  })
})

describe('canvasUpdateInputSchema (.refine: at-least-one of name|scene)', () => {
  it('accepts { id, name }', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: VALID_UUID,
      name: 'New name',
    })
    expect(r.success).toBe(true)
  })

  it('accepts { id, scene }', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: VALID_UUID,
      scene: { elements: [] },
    })
    expect(r.success).toBe(true)
  })

  it('accepts { id, name, scene }', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: VALID_UUID,
      name: 'X',
      scene: { elements: [] },
    })
    expect(r.success).toBe(true)
  })

  it('rejects { id } alone (neither name nor scene supplied)', () => {
    const r = canvasUpdateInputSchema.safeParse({ id: VALID_UUID })
    expect(r.success).toBe(false)
    if (!r.success) {
      // The `.refine` message must be on at least one issue.
      const messages = r.error.issues.map((i) => i.message).join(' | ')
      expect(messages).toContain('At least one of name or scene')
    }
  })

  it('rejects a non-UUID id', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: 'not-a-uuid',
      name: 'X',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty name when supplied', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: VALID_UUID,
      name: '',
    })
    expect(r.success).toBe(false)
  })

  it('rejects name >120 chars when supplied', () => {
    const r = canvasUpdateInputSchema.safeParse({
      id: VALID_UUID,
      name: 'a'.repeat(121),
    })
    expect(r.success).toBe(false)
  })
})

describe('canvasUpdateOutputSchema', () => {
  it('accepts a well-formed update response', () => {
    const r = canvasUpdateOutputSchema.safeParse({
      id: VALID_UUID,
      updatedAt: VALID_ISO,
    })
    expect(r.success).toBe(true)
  })

  it('rejects a missing updatedAt', () => {
    const r = canvasUpdateOutputSchema.safeParse({ id: VALID_UUID })
    expect(r.success).toBe(false)
  })
})

describe('canvasDeleteInputSchema', () => {
  it('accepts { id: <uuid> }', () => {
    const r = canvasDeleteInputSchema.safeParse({ id: VALID_UUID })
    expect(r.success).toBe(true)
  })

  it('rejects a non-UUID id', () => {
    const r = canvasDeleteInputSchema.safeParse({ id: 'nope' })
    expect(r.success).toBe(false)
  })

  it('rejects when id is missing', () => {
    const r = canvasDeleteInputSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('canvasDeleteOutputSchema', () => {
  it('accepts { id, deleted: true }', () => {
    const r = canvasDeleteOutputSchema.safeParse({
      id: VALID_UUID,
      deleted: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects deleted: false (literal true required)', () => {
    const r = canvasDeleteOutputSchema.safeParse({
      id: VALID_UUID,
      deleted: false,
    })
    expect(r.success).toBe(false)
  })
})
