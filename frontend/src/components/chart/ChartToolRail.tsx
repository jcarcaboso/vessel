import { useState, type ReactNode } from 'react'
import { Star } from 'lucide-react'
import { Popover } from 'radix-ui'
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
  /** Marks an action that removes something, shown in red. */
  destructive?: boolean
}

/** Related tools behind one button, which shows `current`; a side panel lists them all. */
export interface ChartToolGroup {
  id: string
  label: string
  tools: readonly ChartTool[]
  current: string
}

const isGroup = (item: ChartTool | ChartToolGroup): item is ChartToolGroup => 'tools' in item

/** Vertical tool rail beside the chart canvas. Groups open a panel where tools can also be starred as favorites. */
export function ChartToolRail({ tools, active, onSelect, groups = [], footer, unavailableReason = 'Not available yet', favorites = [], onToggleFavorite }: {
  tools: readonly (ChartTool | ChartToolGroup)[]
  favorites?: readonly string[]
  onToggleFavorite?: (id: string) => void
  active: string
  onSelect: (id: string) => void
  /** Further tool groups after the main tools, each behind a divider, e.g. feature-specific tools. */
  groups?: readonly { label: string; tools: readonly ChartTool[] }[]
  footer?: readonly ChartTool[]
  unavailableReason?: string
}) {
  const button = (tool: ChartTool) => <ChartIconButton key={tool.id} label={tool.label} icon={tool.icon}
    pressed={tool.pressed ?? tool.id === active} disabled={!tool.available} disabledReason={tool.unavailableReason ?? unavailableReason}
    description={tool.description} tooltipSide="right" className={tool.destructive ? 'is-destructive' : undefined} onClick={() => onSelect(tool.id)} />
  return <div className="chart-tool-rail" role="group" aria-label="Chart tools">
    {tools.map(item => isGroup(item) && item.tools.length === 1 ? button(item.tools[0]!) : isGroup(item)
      ? <ToolGroupButton key={item.id} group={item} active={active} onSelect={onSelect} favorites={favorites} onToggleFavorite={onToggleFavorite} />
      : button(item))}
    {groups.filter(group => group.tools.length > 0).map(group => <div key={group.label} className="chart-rail-group" role="group" aria-label={group.label}>
      <span className="chart-rail-divider" aria-hidden="true" />{group.tools.map(button)}
    </div>)}
    {footer && footer.length > 0 && <><span className="chart-rail-divider" aria-hidden="true" />{footer.map(button)}</>}
  </div>
}

function ToolGroupButton({ group, active, onSelect, favorites, onToggleFavorite }: {
  group: ChartToolGroup
  active: string
  onSelect: (id: string) => void
  favorites: readonly string[]
  onToggleFavorite?: ((id: string) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const current = group.tools.find(tool => tool.id === group.current) ?? group.tools[0]!
  return <div className="chart-tool-group" role="group" aria-label={group.label}>
    <ChartIconButton label={current.label} description={current.description} icon={current.icon} tooltipSide="right"
      pressed={group.tools.some(tool => tool.id === active)} onClick={() => onSelect(current.id)} />
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="chart-tool-group-more" aria-label={`${group.label} tools`}><i aria-hidden="true" /></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="chart-popover chart-tool-flyout" side="right" align="start" sideOffset={6} aria-label={`${group.label} tools`}>
          <p className="chart-tool-flyout-title">{group.label}</p>
          <ul>
            {group.tools.map(tool => {
              const favorite = favorites.includes(tool.id)
              return <li key={tool.id}>
                <button type="button" className="chart-popover-choice" aria-current={tool.id === active}
                  onClick={() => { onSelect(tool.id); setOpen(false) }}>{tool.icon}<span>{tool.label}</span></button>
                {onToggleFavorite && <button type="button" className="chart-tool-favorite" aria-pressed={favorite}
                  aria-label={favorite ? `Remove ${tool.label} from favorites` : `Add ${tool.label} to favorites`}
                  onClick={() => onToggleFavorite(tool.id)}><Star size={13} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} /></button>}
              </li>
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>
}
