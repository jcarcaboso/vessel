import { createContext, useContext, type ReactNode } from 'react'

export type NotificationTone = 'error' | 'warning' | 'success' | 'info'

/**
 * Why a popup closed: its close button (`dismissed`, also the default for `dismiss`), one of its actions, its timer,
 * a newer popup with the same key, the stack being full, or the caller withdrawing it.
 */
export type NotificationCloseReason = 'dismissed' | 'action' | 'timeout' | 'replaced' | 'evicted' | 'withdrawn'

export interface NotificationAction { label: string; onClick: () => void }

export interface NotificationInput {
  message: ReactNode
  tone?: NotificationTone
  title?: string
  /** A notification with the same key replaces the shown one instead of stacking. */
  key?: string
  /** Milliseconds before it closes; null keeps it until dismissed. Defaults by tone. */
  duration?: number | null
  /** `visible-focused` runs the timer only while the tab is visible and its window focused. Hover and focus pause it either way. */
  timer?: 'always' | 'visible-focused'
  action?: NotificationAction
  /** Further actions after `action`, each a button named by its text. */
  actions?: NotificationAction[]
  /** Accessible name of the close button. */
  closeLabel?: string
  /** Called once, whatever closed it. */
  onClose?: (reason: NotificationCloseReason) => void
}

export interface Notifications {
  /** Shows a popup notification and returns its id. */
  notify: (input: NotificationInput) => string
  /** Closes a notification by id or key, by default as `dismissed`. */
  dismiss: (idOrKey: string, reason?: NotificationCloseReason) => void
}

export const NotificationContext = createContext<Notifications | null>(null)

/** Popup notifications of the application shell. */
export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications needs a NotificationProvider.')
  return context
}
