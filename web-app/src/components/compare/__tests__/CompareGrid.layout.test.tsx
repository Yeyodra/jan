/**
 * Layout regression test for CompareGrid.
 *
 * Bug context: when an AI streamed a long response into a Compare column,
 * the implicit grid row (default: `auto`) would size to the tallest cell
 * content, pushing the grid taller than its bounded parent and visually
 * misaligning the column headers (column 1's header would end up anchored
 * lower than columns 2 and 3).
 *
 * Fix: pin every implicit row to an equal fraction of the container's
 * height via `auto-rows-fr`. This test asserts the class contract — if a
 * future refactor drops `auto-rows-fr`, this test fails before the bug
 * regresses into production.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom'
import { CompareGrid } from '../CompareGrid'

describe('CompareGrid layout contract', () => {
  it('declares auto-rows-fr so implicit rows share equal bounded height', () => {
    const { container } = render(
      <CompareGrid>
        <div>col 1</div>
        <div>col 2</div>
        <div>col 3</div>
      </CompareGrid>
    )
    const grid = container.firstElementChild as HTMLElement
    expect(grid).not.toBeNull()
    expect(grid.className).toContain('auto-rows-fr')
  })

  it('keeps the no-page-scroll overflow chain (h-full + overflow-hidden)', () => {
    const { container } = render(
      <CompareGrid>
        <div>col 1</div>
      </CompareGrid>
    )
    const grid = container.firstElementChild as HTMLElement
    expect(grid.className).toContain('h-full')
    expect(grid.className).toContain('overflow-hidden')
  })

  it('wraps every child in a min-h-0 min-w-0 cell so nested overflow can shrink below content size', () => {
    const { container } = render(
      <CompareGrid>
        <div data-testid="a">col 1</div>
        <div data-testid="b">col 2</div>
      </CompareGrid>
    )
    const grid = container.firstElementChild as HTMLElement
    const cells = Array.from(grid.children) as HTMLElement[]
    expect(cells).toHaveLength(2)
    for (const cell of cells) {
      expect(cell.className).toContain('min-h-0')
      expect(cell.className).toContain('min-w-0')
    }
  })

  it('declares the locked responsive column counts (1 / md:2 / xl:3)', () => {
    const { container } = render(
      <CompareGrid>
        <div>x</div>
      </CompareGrid>
    )
    const grid = container.firstElementChild as HTMLElement
    expect(grid.className).toContain('grid-cols-1')
    expect(grid.className).toContain('md:grid-cols-2')
    expect(grid.className).toContain('xl:grid-cols-3')
  })
})
