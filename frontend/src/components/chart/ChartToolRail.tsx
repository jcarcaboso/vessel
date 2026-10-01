import type { ReactNode } from 'react'
import { ChartIconButton } from './ChartToolbar'

export interface ChartTool {
  id: string
  label: string
  icon: ReactNode
  /** Unavailable tools stay visible but cannot be selected. */
  available: boolean
}

/** Vertical tool rail beside the chart canvas. */
export function ChartToolRail({ tools, active, onSelect, footer, unavailableReason = 'Not available yet' }: {
  tools: readonly ChartTool[]
  active: string
  onSelect: (id: string) => void
  footer?: readonly ChartTool[]
  unavailableReason?: string
}) {
  const button = (tool: ChartTool) => <ChartIconButton key={tool.id} label={tool.label} icon={tool.icon}
    pressed={tool.id === active} disabled={!tool.available} disabledReason={unavailableReason} onClick={() => onSelect(tool.id)} />
  return <div className="chart-tool-rail" role="group" aria-label="Chart tools">
    {tools.map(button)}
    {footer && footer.length > 0 && <><span className="chart-rail-divider" aria-hidden="true" />{footer.map(button)}</>}
  </div>
}
