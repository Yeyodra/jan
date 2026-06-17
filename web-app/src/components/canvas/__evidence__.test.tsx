/**
 * Evidence dump — runs once via vitest to write screen.debug() output for
 * three CanvasPromptBar states into .sisyphus/evidence/. Disposable;
 * not part of the core test suite. Skips when EVIDENCE !== '1'.
 */
import { describe, it } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { CanvasPromptBar } from './CanvasPromptBar'

const EVIDENCE_PATH = resolve(
  __dirname,
  '../../../../.sisyphus/evidence/task-18-prompt-bar-render.txt',
)

const enabled = process.env.EVIDENCE === '1'

describe.runIf(enabled)('CanvasPromptBar evidence', () => {
  it('writes screen.debug() output for idle / submitting / no-canvas', () => {
    const sections: string[] = []

    sections.push('=== IDLE (canvasId=canvas-1, isSubmitting=false) ===')
    const idle = render(
      <CanvasPromptBar
        canvasId="canvas-1"
        isSubmitting={false}
        onSubmit={() => {}}
      />,
    )
    sections.push(idle.container.outerHTML)
    idle.unmount()

    sections.push('')
    sections.push(
      '=== SUBMITTING (canvasId=canvas-1, isSubmitting=true) ===',
    )
    const submitting = render(
      <CanvasPromptBar
        canvasId="canvas-1"
        isSubmitting={true}
        onSubmit={() => {}}
      />,
    )
    sections.push(submitting.container.outerHTML)
    submitting.unmount()

    sections.push('')
    sections.push('=== NO CANVAS (canvasId=null, isSubmitting=false) ===')
    const noCanvas = render(
      <CanvasPromptBar
        canvasId={null}
        isSubmitting={false}
        onSubmit={() => {}}
      />,
    )
    sections.push(noCanvas.container.outerHTML)
    noCanvas.unmount()

    writeFileSync(EVIDENCE_PATH, sections.join('\n'), 'utf8')
  })
})
