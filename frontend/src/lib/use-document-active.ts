import { useSyncExternalStore } from 'react'

const events = ['visibilitychange', 'focus', 'blur'] as const

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  for (const event of events.slice(1)) window.addEventListener(event, onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
    for (const event of events.slice(1)) window.removeEventListener(event, onChange)
  }
}

/** Whether this tab is visible and its window has focus: someone may be looking at it right now. */
export const isDocumentActive = () => document.visibilityState === 'visible' && document.hasFocus()

/** `isDocumentActive`, updated when the tab is shown or hidden and when its window gains or loses focus. */
export function useDocumentActive() {
  return useSyncExternalStore(subscribe, isDocumentActive, () => false)
}
