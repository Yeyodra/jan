import { describe, it, expect, expectTypeOf } from 'vitest'
import type { MCPToolCallResult } from '@janhq/core'
import {
  OrchestratorResponsibility,
  type OrchestratorRequest,
  type OrchestratorState,
  type McpToolCall,
  type McpToolResult,
  type ElementIdMapping,
  type OrchestratorResponsibilityName,
  type Telemetry,
} from './types'

describe('CanvasMcpOrchestrator contract types', () => {
  describe('OrchestratorRequest', () => {
    it('has the four required string fields', () => {
      expectTypeOf<OrchestratorRequest>().toHaveProperty('canvasId').toEqualTypeOf<string>()
      expectTypeOf<OrchestratorRequest>().toHaveProperty('prompt').toEqualTypeOf<string>()
      expectTypeOf<OrchestratorRequest>().toHaveProperty('threadId').toEqualTypeOf<string>()
      expectTypeOf<OrchestratorRequest>().toHaveProperty('modelId').toEqualTypeOf<string>()
    })
  })

  describe('OrchestratorState', () => {
    it('is exactly the 5 string literals', () => {
      expectTypeOf<OrchestratorState>().toEqualTypeOf<
        'idle' | 'spawning' | 'awaiting-approval' | 'drawing' | 'error'
      >()
    })

    it('rejects unknown states at the type level', () => {
      // @ts-expect-error 'busy' is not a valid OrchestratorState
      const _bad: OrchestratorState = 'busy'
      void _bad
    })
  })

  describe('McpToolCall', () => {
    it('has a string name and a record of arguments', () => {
      expectTypeOf<McpToolCall>().toHaveProperty('name').toEqualTypeOf<string>()
      expectTypeOf<McpToolCall>()
        .toHaveProperty('arguments')
        .toEqualTypeOf<Record<string, unknown>>()
    })
  })

  describe('McpToolResult', () => {
    it('is a discriminated union of success-shape vs error-shape', () => {
      const success: McpToolResult = {
        content: [{ type: 'text', text: 'ok' }],
      }
      const failure: McpToolResult = { error: 'boom' }
      expect(success).toBeDefined()
      expect(failure).toBeDefined()

      // Success branch shape
      expectTypeOf<{ content: Array<{ type: 'text'; text: string }> }>().toMatchTypeOf<McpToolResult>()
      // Error branch shape
      expectTypeOf<{ error: string }>().toMatchTypeOf<McpToolResult>()
    })

    it('is structurally compatible with Jan core MCPToolCallResult', () => {
      // Jan core's MCPToolCallResult is { error: string, content: Array<{ type?: string, text: string }> }.
      // A value of that shape must be assignable through one of our union branches
      // (the success branch — `content` matches; `error` is an extra, ignored, property
      //  under TS structural typing for assignability).
      const janCoreResult: MCPToolCallResult = {
        error: '',
        content: [{ type: 'text', text: 'hello' }],
      }
      // Round-trip: our success branch can read from a Jan-core result
      const ours: McpToolResult = { content: janCoreResult.content as Array<{ type: 'text'; text: string }> }
      expect(ours).toBeDefined()
    })
  })

  describe('ElementIdMapping', () => {
    it('is a Map<string, string>', () => {
      expectTypeOf<ElementIdMapping>().toEqualTypeOf<Map<string, string>>()
      const m: ElementIdMapping = new Map([['mcp-1', 'canvas-1']])
      expect(m.get('mcp-1')).toBe('canvas-1')
    })
  })

  describe('OrchestratorResponsibility', () => {
    it('exposes exactly 11 keys', () => {
      expect(Object.keys(OrchestratorResponsibility)).toHaveLength(11)
    })

    it('exposes the canonical 11 method names verbatim', () => {
      const expected = [
        'resolveActiveCanvas',
        'dispatchToolCall',
        'translateElementId',
        'syncStateFromCanvas',
        'beginAiBatch',
        'endAiBatch',
        'handleProcessCrash',
        'translateToolResult',
        'applyTheme',
        'lockManualEdits',
        'enforceCuratedToolList',
      ] as const
      expect(Object.keys(OrchestratorResponsibility).sort()).toEqual([...expected].sort())
    })

    it('exposes a name-union type with the same 11 members', () => {
      expectTypeOf<OrchestratorResponsibilityName>().toEqualTypeOf<
        | 'resolveActiveCanvas'
        | 'dispatchToolCall'
        | 'translateElementId'
        | 'syncStateFromCanvas'
        | 'beginAiBatch'
        | 'endAiBatch'
        | 'handleProcessCrash'
        | 'translateToolResult'
        | 'applyTheme'
        | 'lockManualEdits'
        | 'enforceCuratedToolList'
      >()
    })
  })

  describe('Telemetry', () => {
    it('spawnDurationMs is optional; other counters are required', () => {
      // Required fields present, spawnDurationMs omitted — must typecheck.
      const t1: Telemetry = {
        toolCallCount: 0,
        batchSize: 0,
        approvalCount: 0,
        errors: [],
      }
      expect(t1.spawnDurationMs).toBeUndefined()

      // All fields present.
      const t2: Telemetry = {
        spawnDurationMs: 123,
        toolCallCount: 1,
        batchSize: 1,
        approvalCount: 1,
        errors: ['x'],
      }
      expect(t2.spawnDurationMs).toBe(123)

      // Type-level: spawnDurationMs is `number | undefined`, others are not undefined-able.
      expectTypeOf<Telemetry>().toHaveProperty('spawnDurationMs').toEqualTypeOf<number | undefined>()
      expectTypeOf<Telemetry>().toHaveProperty('toolCallCount').toEqualTypeOf<number>()
      expectTypeOf<Telemetry>().toHaveProperty('batchSize').toEqualTypeOf<number>()
      expectTypeOf<Telemetry>().toHaveProperty('approvalCount').toEqualTypeOf<number>()
      expectTypeOf<Telemetry>().toHaveProperty('errors').toEqualTypeOf<string[]>()
    })

    it('rejects missing required fields', () => {
      // @ts-expect-error missing required counters
      const _bad: Telemetry = { spawnDurationMs: 1 }
      void _bad
    })
  })
})
