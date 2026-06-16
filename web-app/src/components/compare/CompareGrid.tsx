import type { ReactNode } from 'react'
import { Children, isValidElement } from 'react'
import { cn } from '@/lib/utils'

export interface CompareGridProps {
  children: ReactNode
  className?: string
}

export function CompareGrid({ children, className }: CompareGridProps) {
  return (
    <div
      className={cn(
        'grid h-full overflow-hidden gap-3 p-3',
        // auto-rows-fr pins every implicit grid row to an equal fraction of
        // the container's bounded height. Without it, grid implicit rows
        // default to `auto` (content-sized), so a column with a long streaming
        // response would stretch its row, pushing the grid taller than its
        // parent's bounded height and visually misaligning the column headers
        // (column 1 ends up anchored lower than columns 2/3). With
        // auto-rows-fr every row shares equal height and the long content
        // scrolls *inside* the column via the column's own overflow-y-auto.
        'auto-rows-fr',
        'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
        className
      )}
    >
      {Children.map(children, (child, idx) => {
        // Wrap each child in a min-h-0 min-w-0 cell so nested overflow works.
        // Without these, grid children default to min-height: auto and cannot
        // shrink below their content size, breaking per-column overflow scroll.
        const key =
          (isValidElement(child) && child.key !== null ? child.key : idx) ?? idx
        return (
          <div key={key} className="min-h-0 min-w-0">
            {child}
          </div>
        )
      })}
    </div>
  )
}

export default CompareGrid
