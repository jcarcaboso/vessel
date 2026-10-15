import { useId, useRef, useState, type ReactNode } from 'react'
import { Info, type LucideIcon } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { cn } from '@/lib/utils'
import './info-tip.css'

type InfoTipProps = {
  /** Accessible name of the icon button, naming the topic, e.g. "About nominal USD". */
  label: string
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  icon?: LucideIcon
  /** Visible trigger content in place of the icon, e.g. a coverage pill. */
  trigger?: ReactNode
  className?: string
}

/**
 * Detail that would otherwise sit on the page as helper text: a small info icon beside the thing it concerns.
 * Hover, focus or tap opens it; screen readers get the detail as the button's description. Each tip carries its own
 * provider (with the shell's timings), so it also works outside the shell, e.g. on the connection screen.
 */
export function InfoTip({ label, children, side = 'top', icon: Icon = Info, trigger, className }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const wasOpen = useRef(false)
  const detailId = `${useId()}-detail`
  // A tip whose detail is its own name needs no separate description.
  const described = !(typeof children === 'string' && children === label)
  return <Tooltip.Provider delayDuration={250} skipDelayDuration={400}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild>
      {/* A span, not a button: a disabled fieldset (read-only plans) must not disable the explanation. */}
      <span role="button" tabIndex={0} className={cn(trigger === undefined ? 'info-tip' : 'info-tip-trigger', className)} aria-label={label} aria-describedby={described ? detailId : undefined}
        onPointerDown={() => { wasOpen.current = open }}
        onClick={event => {
          // Taps do not open Radix tooltips, so a click toggles it.
          event.preventDefault(); event.stopPropagation()
          setOpen(!wasOpen.current)
        }}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault(); event.stopPropagation()
          setOpen(!open)
        }}>
        {trigger ?? <Icon aria-hidden="true" />}
      </span>
    </Tooltip.Trigger>
    {described && <span id={detailId} className="sr-only info-tip-detail">{children}</span>}
    <Tooltip.Portal>
      <Tooltip.Content className="info-tip-content" side={side} sideOffset={6} collisionPadding={8} aria-hidden="true">
        {children}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>
}
