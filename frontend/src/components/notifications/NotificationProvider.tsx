import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'
import { NotificationContext, type NotificationInput, type NotificationTone } from './notifications'
import './notifications.css'

interface Shown extends NotificationInput {
  id: string
  tone: NotificationTone
  slot: number
}

const defaultDuration: Record<NotificationTone, number> = { error: 10000, success: 5500, info: 5500 }
/** Older notifications close when more than this many are shown. */
const maxShown = 4
const slots = Array.from({ length: maxShown }, (_, index) => index)
const icons = { error: CircleAlert, success: Check, info: Info }

let sequence = 0

/** Keeps popup notifications in a stack at the bottom right of the page. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown[]>([])
  const dismiss = useCallback((idOrKey: string) =>
    setShown(current => current.filter(item => item.id !== idOrKey && item.key !== idOrKey)), [])
  const notify = useCallback((input: NotificationInput) => {
    const id = `notification-${++sequence}`
    setShown(current => {
      const retained = current.filter(existing => !input.key || existing.key !== input.key).slice(-(maxShown - 1))
      const slot = slots.find(slot => !retained.some(item => item.slot === slot))!
      return [...retained, { ...input, id, tone: input.tone ?? 'info', slot }]
    })
    return id
  }, [])
  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return <NotificationContext.Provider value={value}>
    {children}
    <section className="notification-viewport" aria-label="Notifications">
      {/* Fixed slots keep the live regions mounted and each toast's focus/timer intact.
          Reordering keyed slots keeps the original chronological stack and tab order. */}
      {[...shown.map(item => item.slot), ...slots.filter(slot => !shown.some(item => item.slot === slot))].map(slot => {
        const item = shown.find(item => item.slot === slot)
        return <Fragment key={slot}>
          <div aria-live="polite" aria-relevant="additions text" style={{ display: 'contents' }}>
            {item && item.tone !== 'error' && <Notification key={item.id} item={item} onClose={() => dismiss(item.id)} />}
          </div>
          <div aria-live="assertive" aria-relevant="additions text" style={{ display: 'contents' }}>
            {item?.tone === 'error' && <Notification key={item.id} item={item} onClose={() => dismiss(item.id)} />}
          </div>
        </Fragment>
      })}
    </section>
  </NotificationContext.Provider>
}

function Notification({ item, onClose }: { item: Shown; onClose: () => void }) {
  const duration = item.duration === undefined ? defaultDuration[item.tone] : item.duration
  const [paused, setPaused] = useState(false)
  // Hover or focus pauses the timer; it restarts in full afterwards so the message can still be read.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    if (duration === null || paused) return
    const timer = setTimeout(() => close.current(), duration)
    return () => clearTimeout(timer)
  }, [duration, paused])
  const Icon = icons[item.tone]
  return <div className={`notification is-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}
    onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <Icon size={15} aria-hidden="true" />
    <div className="notification-body">
      {item.title && <strong>{item.title}</strong>}
      <span>{item.message}</span>
    </div>
    {item.action && <button type="button" className="notification-action" onClick={() => { item.action!.onClick(); onClose() }}>{item.action.label}</button>}
    <button type="button" className="notification-close" aria-label="Dismiss notification" onClick={onClose}><X size={14} aria-hidden="true" /></button>
  </div>
}
