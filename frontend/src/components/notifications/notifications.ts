import { createContext, useContext, type ReactNode } from 'react'

export type NotificationTone = 'error' | 'success' | 'info'

export interface NotificationInput {
  message: ReactNode
  tone?: NotificationTone
  title?: string
  /** A notification with the same key replaces the shown one instead of stacking. */
  key?: string
  /** Milliseconds before it closes; null keeps it until dismissed. Defaults by tone. */
  duration?: number | null
  action?: { label: string; onClick: () => void }
}

export interface Notifications {
  /** Shows a popup notification and returns its id. */
  notify: (input: NotificationInput) => string
  /** Closes a notification by id or key. */
  dismiss: (idOrKey: string) => void
}

export const NotificationContext = createContext<Notifications | null>(null)

/** Popup notifications of the application shell. */
export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications needs a NotificationProvider.')
  return context
}
