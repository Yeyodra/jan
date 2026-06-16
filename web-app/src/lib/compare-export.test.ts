import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCompareFilename,
  buildCompareMarkdown,
  exportCompareToFile,
} from './compare-export'
import type { CompareExportData } from '@/types/compare'

// ---------------------------------------------------------------------------
// Mock surface — service hub + platform detection
// ---------------------------------------------------------------------------

const mockSave = vi.fn()
const mockInvoke = vi.fn()
const mockIsTauri = vi.fn(() => true)

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    dialog: () => ({ save: mockSave }),
    core: () => ({ invoke: mockInvoke }),
  }),
  useServiceHub: () => ({
    dialog: () => ({ save: mockSave }),
    core: () => ({ invoke: mockInvoke }),
  }),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => mockIsTauri(),
}))

beforeEach(() => {
  mockSave.mockReset()
  mockInvoke.mockReset()
  mockIsTauri.mockReset()
  mockIsTauri.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeColumn = (
  provider: string,
  modelId: string,
  messages: any[] = [],
  ttftMs: number | null = 120,
  totalMs: number | null = 800,
  outputTokens: number | null = 42
) => ({
  provider,
  modelId,
  metrics: { ttftMs, totalMs, outputTokens },
  messages,
})

const userMsg = (text: string) => ({
  role: 'user' as const,
  parts: [{ type: 'text' as const, text }],
})
const asstMsg = (text: string) => ({
  role: 'assistant' as const,
  parts: [{ type: 'text' as const, text }],
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildCompareFilename', () => {
  it('matches the canonical pattern for an arbitrary date', () => {
    const out = buildCompareFilename(new Date(2026, 5, 15, 14, 32, 0))
    // Month index 5 → June (06). Hours/minutes are local; we still pin them
    // because we constructed via local-time fields.
    expect(out).toBe('jan-compare-2026-06-15-1432.md')
    expect(out).toMatch(/^jan-compare-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)
  })

  it('default (no arg) produces a valid filename', () => {
    expect(buildCompareFilename()).toMatch(
      /^jan-compare-\d{4}-\d{2}-\d{2}-\d{4}\.md$/
    )
  })
})

describe('buildCompareMarkdown', () => {
  const baseData = (overrides: Partial<CompareExportData> = {}): CompareExportData => ({
    generatedAt: '2026-06-15T14:32:00.000Z',
    masterPrompt: 'Hello world',
    columns: [],
    ...overrides,
  } as CompareExportData)

  it('handles empty columns with the master prompt + No-columns note', () => {
    const md = buildCompareMarkdown(
      baseData({ masterPrompt: '', columns: [] })
    )
    expect(md).toContain('# Jan Compare — 2026-06-15T14:32:00.000Z')
    expect(md).toContain('## Master Prompt')
    expect(md).toContain('_(empty prompt)_')
    expect(md).toContain('_No columns to export._')
    expect(md).not.toContain('## Column 1')
  })

  it('renders 1 column with 1 turn faithfully', () => {
    const data = baseData({
      columns: [
        makeColumn('OpenAI', 'gpt-4o', [
          userMsg('Hi there'),
          asstMsg('Hello! How can I help?'),
        ]),
      ],
    })
    const md = buildCompareMarkdown(data as CompareExportData)
    expect(md).toContain('## Column 1 — OpenAI / gpt-4o')
    expect(md).toContain('| TTFT | 120 ms |')
    expect(md).toContain('| Total time | 800 ms |')
    expect(md).toContain('| Output tokens | 42 |')
    expect(md).toContain('**User:** Hi there')
    expect(md).toContain('**Assistant:** Hello! How can I help?')
    // Single column → no divider line.
    expect(md.split('\n').filter((l) => l.trim() === '---').length).toBe(0)
  })

  it('places dividers between every pair of 6 columns but not after the last', () => {
    const cols = Array.from({ length: 6 }, (_, i) =>
      makeColumn(`P${i + 1}`, `m${i + 1}`, [userMsg('q'), asstMsg('a')])
    )
    const md = buildCompareMarkdown(
      baseData({ columns: cols }) as CompareExportData
    )
    for (let i = 1; i <= 6; i++) {
      expect(md).toContain(`## Column ${i} — P${i} / m${i}`)
    }
    const dividerCount = md.split('\n').filter((l) => l.trim() === '---').length
    expect(dividerCount).toBe(5)
  })

  it('renders null metrics as em-dash', () => {
    const data = baseData({
      columns: [makeColumn('P', 'm', [], null, null, null)],
    })
    const md = buildCompareMarkdown(data as CompareExportData)
    expect(md).toContain('| TTFT | — ms |')
    expect(md).toContain('| Total time | — ms |')
    expect(md).toContain('| Output tokens | — |')
  })

  it('redacts API key patterns in message text', () => {
    const data = baseData({
      columns: [
        makeColumn('P', 'm', [
          userMsg(
            'My key is sk-abcdef1234567890ABCDEF and Bearer xyz123abc456 stays secret'
          ),
        ]),
      ],
    })
    const md = buildCompareMarkdown(data as CompareExportData)
    expect(md).toContain('[redacted]')
    expect(md).not.toContain('sk-abcdef1234567890ABCDEF')
    expect(md).not.toContain('Bearer xyz123abc456')
  })

  it('wraps multi-line master prompt in a fenced code block but leaves single-line prompts as paragraphs', () => {
    const multi = buildCompareMarkdown(
      baseData({ masterPrompt: 'line one\nline two' }) as CompareExportData
    )
    expect(multi).toMatch(/```text\nline one\nline two\n```/)

    const single = buildCompareMarkdown(
      baseData({ masterPrompt: 'just one line' }) as CompareExportData
    )
    expect(single).not.toContain('```text')
    expect(single).toContain('just one line')
  })

  it('emits placeholder for non-text-only message parts', () => {
    const data = baseData({
      columns: [
        makeColumn('P', 'm', [
          {
            role: 'user' as const,
            parts: [{ type: 'image', image: 'data:image/png;base64,...' }],
          },
        ]),
      ],
    })
    const md = buildCompareMarkdown(data as CompareExportData)
    expect(md).toContain('_(non-text content omitted)_')
  })
})

describe('exportCompareToFile', () => {
  const sampleData: CompareExportData = {
    generatedAt: '2026-06-15T14:32:00.000Z',
    masterPrompt: 'hi',
    columns: [makeColumn('P', 'm', [userMsg('q'), asstMsg('a')]) as any],
  }

  it('returns cancelled when the dialog returns null in Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(true)
    mockSave.mockResolvedValue(null)
    const out = await exportCompareToFile(sampleData)
    expect(out).toEqual({ ok: false, reason: 'cancelled' })
    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('writes via core().invoke and returns ok with the chosen path on Tauri', async () => {
    mockIsTauri.mockReturnValue(true)
    mockSave.mockResolvedValue('/tmp/out.md')
    mockInvoke.mockResolvedValue(undefined)
    const out = await exportCompareToFile(sampleData)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.path).toBe('/tmp/out.md')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockInvoke.mock.calls[0]
    expect(cmd).toBe('write_file_sync')
    expect(args).toMatchObject({ args: ['/tmp/out.md', expect.any(String)] })
  })

  it('falls back to blob download in non-Tauri runtime', async () => {
    mockIsTauri.mockReturnValue(false)

    const created = vi.fn()
    const revoked = vi.fn()
    const click = vi.fn()
    // jsdom has URL.createObjectURL undefined by default — stub it.
    const origCreate = (URL as any).createObjectURL
    const origRevoke = (URL as any).revokeObjectURL
    ;(URL as any).createObjectURL = (b: Blob) => {
      created(b)
      return 'blob:fake'
    }
    ;(URL as any).revokeObjectURL = (u: string) => revoked(u)

    const realCreate = document.createElement.bind(document)
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreate(tag) as HTMLElement
        if (tag === 'a') {
          ;(el as HTMLAnchorElement).click = click
        }
        return el
      })

    try {
      const out = await exportCompareToFile(sampleData)
      expect(out.ok).toBe(true)
      if (out.ok) expect(out.path).toMatch(/^jan-compare-/)
      expect(created).toHaveBeenCalledTimes(1)
      expect(click).toHaveBeenCalledTimes(1)
      expect(revoked).toHaveBeenCalledWith('blob:fake')
      expect(mockSave).not.toHaveBeenCalled()
    } finally {
      createSpy.mockRestore()
      ;(URL as any).createObjectURL = origCreate
      ;(URL as any).revokeObjectURL = origRevoke
    }
  })

  it('returns error when core().invoke rejects', async () => {
    mockIsTauri.mockReturnValue(true)
    mockSave.mockResolvedValue('/tmp/out.md')
    mockInvoke.mockRejectedValue(new Error('disk full'))
    const out = await exportCompareToFile(sampleData)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toBe('error')
      expect(out.message).toContain('disk full')
    }
  })
})
