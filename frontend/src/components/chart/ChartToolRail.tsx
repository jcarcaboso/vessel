import type { ReactNode } from 'react'
import { ChartIconButton } from './ChartToolbar'

export interface ChartTool {
  id: string
  label: string
  /** One line on what the tool does, shown under its name in the tooltip. */
  description?: string
  icon: ReactNode
  /** Unavailable tools stay visible but cannot be selected. */
  available: boolean
  /** Toggle state for utilities such as a magnet; defaults to being the active tool. */
  pressed?: boolean
  /** Why this tool is unavailable; defaults to the rail's reason. */
  unavailableReason?: string
}

/** Vertical tool rail beside the chart canvas. */
export function ChartToolRail({ tools, active, onSelect, groups = [], footer, unavailableReason = 'Not available yet' }: {
  tools: readonly ChartTool[]
  active: string
  onSelect: (id: string) => void
  /** Further tool groups after the main tools, each behind a divider, e.g. feature-specific tools. */
  groups?: readonly { label: string; tools: readonly ChartTool[] }[]
  footer?: readonly ChartTool[]
  unavailableReason?: string
}) {
  const button = (tool: ChartTool) => <ChartIconButton key={tool.id} label={tool.label} icon={tool.icon}
    pressed={tool.pressed ?? tool.id === active} disabled={!tool.available} disabledReason={tool.unavailableReason ?? unavailableReason}
    description={tool.description} tooltipSide="right" onClick={() => onSelect(tool.id)} />
  return <div className="chart-tool-rail" role="group" aria-label="Chart tools">
    {tools.map(button)}
    {groups.filter(group => group.tools.length > 0).map(group => <div key={group.label} className="chart-rail-group" role="group" aria-label={group.label}>
      <span className="chart-rail-divider" aria-hidden="true" />{group.tools.map(button)}
    </div>)}
    {footer && footer.length > 0 && <><span className="chart-rail-divider" aria-hidden="true" />{footer.map(button)}</>}
  </div>
}
