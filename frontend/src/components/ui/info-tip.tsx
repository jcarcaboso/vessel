import { useId, useRef, useState, type ReactNode } from 'react'
import { Info, type LucideIcon } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { cn } from '@/lib/utils'
import './info-tip.css'

type InfoTipProps = {
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  icon?: LucideIcon
  className?: string
} & (
  /** An icon button: `label` is its accessible name, naming the topic, e.g. "About nominal USD". */
  | { label: string; trigger?: undefined }
  /**
   * A button showing text in place of the icon, e.g. a coverage pill. Its accessible name always starts with that
   * visible text (WCAG 2.5.3 Label in Name), so someone speaking what they see can activate it. Without a `label` the
   * visible text is the name; a `label` adds context after it. The detail is the description either way.
   */
  | { trigger: string; label?: string }
)

/** The accessible name: the visible text first, then any context. Icon buttons are named by their label alone. */
function accessibleName(label: string | undefined, trigger: string | undefined) {
  if (trigger === undefined) return label
  if (!label) return undefined
  return label.toLowerCase().startsWith(trigger.toLowerCase()) ? label : `${trigger} ${label}`
}

/**
 * Detail that would otherwise sit on the page as helper text: a small info icon beside the thing it concerns.
 * Hover, focus or tap opens it; screen readers get the detail as the button's description. Each tip carries its own
 * provider (with the shell's timings), so it also works outside the shell, e.g. on the connection screen.
 */
export function InfoTip({ label, children, side = 'top', icon: Icon = Info, trigger, className }: InfoTipProps) {
  const [open, setOpen] = useState(false)
  // Whether the tip was open when the current pointer press began; null when no press led to this click.
  const openAtPress = useRef<boolean | null>(null)
  const detailId = `${useId()}-detail`
  // A tip whose detail is its own name needs no separate description.
  const described = !(typeof children === 'string' && children === label)
  return <Tooltip.Provider delayDuration={250} skipDelayDuration={400}><Tooltip.Root open={open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild>
      {/* A span, not a button: a disabled fieldset (read-only plans) must not disable the explanation. */}
      <span role="button" tabIndex={0} className={cn(trigger === undefined ? 'info-tip' : 'info-tip-trigger', className)} aria-label={accessibleName(label, trigger)} aria-describedby={described ? detailId : undefined}
        onPointerDown={() => { openAtPress.current = open }}
        onPointerCancel={() => { openAtPress.current = null }}
        onClick={event => {
          // Taps do not open Radix tooltips, so a click toggles it. Radix closes a hover-opened tip as the press begins,
          // so a pointer click toggles from the state at the press. A click without a press (assistive technology,
          // programmatic activation: detail 0) toggles from the current state, so repeating it opens, then closes.
          event.preventDefault(); event.stopPropagation()
          const before = event.detail > 0 && openAtPress.current !== null ? openAtPress.current : open
          openAtPress.current = null
          setOpen(!before)
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
