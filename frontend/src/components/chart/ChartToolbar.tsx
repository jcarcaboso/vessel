import { forwardRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover, Tooltip } from 'radix-ui'

/** One compact control row. `end` content is pushed to the right edge. */
export function ChartToolbar({ label, children, end }: { label: string; children?: ReactNode; end?: ReactNode }) {
  return <div className="chart-toolbar" role="group" aria-label={label}>
    {children}
    {end && <div className="chart-toolbar-end">{end}</div>}
  </div>
}

export function ChartToolbarDivider() {
  return <span className="chart-toolbar-divider" aria-hidden="true" />
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'type'> & {
  label: string
  icon: ReactNode
  pressed?: boolean
  /** Explanation shown in the tooltip when the action is unavailable. */
  disabledReason?: string
  /** One line under the name in the tooltip, e.g. how to use a drawing tool. */
  description?: string | undefined
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Square icon action with a tooltip naming it, and an accessible name. The tooltip is on a wrapper so
 * it also explains disabled actions, which receive no pointer events.
 */
export const ChartIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function ChartIconButton(
  { label, icon, pressed, disabledReason, description, tooltipSide = 'bottom', className, disabled, ...props }, ref) {
  const detail = disabled && disabledReason ? disabledReason : description
  return <Tooltip.Provider delayDuration={250} skipDelayDuration={400}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="chart-icon-tip">
          <button ref={ref} type="button" className={['chart-icon-button', className].filter(Boolean).join(' ')}
            aria-label={label} aria-pressed={pressed} disabled={disabled} {...props}>{icon}</button>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="chart-tooltip" side={tooltipSide} sideOffset={6} collisionPadding={8}>
          <strong>{label}</strong>{detail && <span>{detail}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
})

export interface ChartMenuOption<T extends string> {
  value: T
  label: string
  /** Optional color swatch, e.g. an entry color. */
  swatch?: string
}

/** Text trigger with a chevron that opens a single-choice list. */
export function ChartMenu<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly ChartMenuOption<T>[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(option => option.value === value)
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button type="button" className="chart-menu-trigger" aria-label={`${label}: ${current?.label ?? ''}`}>
        {current?.swatch && <i className="chart-swatch" style={{ '--swatch': current.swatch } as CSSProperties} aria-hidden="true" />}
        <span>{current?.label}</span><ChevronDown size={13} aria-hidden="true" />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="chart-popover" align="start" sideOffset={6} aria-label={label}>
        <ul>
          {options.map(option => <li key={option.value}>
            <button type="button" className="chart-popover-choice" aria-current={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false) }}>
              {option.swatch && <i className="chart-swatch" style={{ '--swatch': option.swatch } as CSSProperties} aria-hidden="true" />}
              <span>{option.label}</span>{option.value === value && <Check size={13} aria-hidden="true" />}
            </button>
          </li>)}
        </ul>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
