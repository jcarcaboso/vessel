import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, TriangleAlert, X } from 'lucide-react'
import { useDocumentActive } from '@/lib/use-document-active'
import { NotificationContext, type NotificationCloseReason, type NotificationInput, type NotificationTone } from './notifications'
import './notifications.css'

interface Shown extends NotificationInput {
  id: string
  tone: NotificationTone
  slot: number
}

const defaultDuration: Record<NotificationTone, number> = { error: 10000, warning: 10000, success: 5500, info: 5500 }
/** Older notifications close when more than this many are shown. */
const maxShown = 4
const slots = Array.from({ length: maxShown }, (_, index) => index)
const icons = { error: CircleAlert, warning: TriangleAlert, success: Check, info: Info }

let sequence = 0

/** Where focus goes when the popup holding it closes and no other popup is left: the page content, never the body. */
const pageContent = () => document.getElementById('workspace-content') ?? document.querySelector<HTMLElement>('main')

/** Keeps popup notifications in a stack at the bottom right of the page. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown[]>([])
  // The stack outside React's updater, so each closed popup reports its reason exactly once.
  const current = useRef<Shown[]>([])
  const viewport = useRef<HTMLElement>(null)
  const refocus = useRef<{ after: string[] } | null>(null)
  const update = useCallback((next: Shown[], closed: [Shown, NotificationCloseReason][]) => {
    const focused = closed.find(([item]) => viewport.current?.querySelector(`[data-notification="${item.id}"]`)?.contains(document.activeElement))
    if (focused) {
      // The popups that followed it, then those before it, nearest first.
      const order = current.current.map(item => item.id), at = order.indexOf(focused[0].id)
      refocus.current = { after: [...order.slice(at + 1), ...order.slice(0, at).reverse()] }
    }
    current.current = next
    setShown(next)
    for (const [item, reason] of closed) item.onClose?.(reason)
  }, [])
  useLayoutEffect(() => {
    const pending = refocus.current
    if (!pending) return
    refocus.current = null
    const next = pending.after.find(id => shown.some(item => item.id === id))
    const target = next ? viewport.current?.querySelector<HTMLElement>(`[data-notification="${next}"]`) : pageContent()
    target?.focus({ preventScroll: true })
  }, [shown])
  const dismiss = useCallback((idOrKey: string, reason: NotificationCloseReason = 'dismissed') => {
    const closed = current.current.filter(item => item.id === idOrKey || item.key === idOrKey)
    if (closed.length) update(current.current.filter(item => !closed.includes(item)), closed.map(item => [item, reason]))
  }, [update])
  const notify = useCallback((input: NotificationInput) => {
    const id = `notification-${++sequence}`
    const replaced = current.current.filter(existing => input.key && existing.key === input.key)
    const kept = current.current.filter(existing => !replaced.includes(existing))
    const retained = kept.slice(-(maxShown - 1))
    const evicted = kept.slice(0, kept.length - retained.length)
    const slot = slots.find(slot => !retained.some(item => item.slot === slot))!
    update([...retained, { ...input, id, tone: input.tone ?? 'info', slot }],
      [...replaced.map(item => [item, 'replaced'] as [Shown, NotificationCloseReason]), ...evicted.map(item => [item, 'evicted'] as [Shown, NotificationCloseReason])])
    return id
  }, [update])
  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return <NotificationContext.Provider value={value}>
    {children}
    <section ref={viewport} className="notification-viewport" aria-label="Notifications">
      {/* Fixed slots keep the live regions mounted and each toast's focus/timer intact.
          Reordering keyed slots keeps the original chronological stack and tab order. */}
      {[...shown.map(item => item.slot), ...slots.filter(slot => !shown.some(item => item.slot === slot))].map(slot => {
        const item = shown.find(item => item.slot === slot)
        return <Fragment key={slot}>
          <div aria-live="polite" aria-relevant="additions text" style={{ display: 'contents' }}>
            {item && item.tone !== 'error' && <Notification key={item.id} item={item} onClose={reason => dismiss(item.id, reason)} />}
          </div>
          <div aria-live="assertive" aria-relevant="additions text" style={{ display: 'contents' }}>
            {item?.tone === 'error' && <Notification key={item.id} item={item} onClose={reason => dismiss(item.id, reason)} />}
          </div>
        </Fragment>
      })}
    </section>
  </NotificationContext.Provider>
}

function Notification({ item, onClose }: { item: Shown; onClose: (reason: NotificationCloseReason) => void }) {
  const duration = item.duration === undefined ? defaultDuration[item.tone] : item.duration
  const [paused, setPaused] = useState(false)
  const active = useDocumentActive()
  // A visible-focused timer waits while nobody can be looking at the tab.
  const waiting = item.timer === 'visible-focused' && !active
  // Hover or focus pauses the timer; it restarts in full afterwards so the message can still be read.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    if (duration === null || paused || waiting) return
    const timer = setTimeout(() => close.current('timeout'), duration)
    return () => clearTimeout(timer)
  }, [duration, paused, waiting])
  const Icon = icons[item.tone]
  const actions = [...item.action ? [item.action] : [], ...item.actions ?? []]
  return <div className={`notification is-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'} data-notification={item.id} tabIndex={-1}
    onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <Icon size={15} aria-hidden="true" />
    <div className="notification-body">
      {item.title && <strong>{item.title}</strong>}
      <span>{item.message}</span>
      {actions.length > 1 && <div className="notification-actions">{actions.map((action, index) =>
        <button key={index} type="button" className="notification-action" onClick={() => { action.onClick(); onClose('action') }}>{action.label}</button>)}</div>}
    </div>
    {actions.length === 1 && <button type="button" className="notification-action" onClick={() => { actions[0]!.onClick(); onClose('action') }}>{actions[0]!.label}</button>}
    <button type="button" className="notification-close" aria-label={item.closeLabel ?? 'Dismiss notification'} onClick={() => onClose('dismissed')}><X size={14} aria-hidden="true" /></button>
  </div>
}
