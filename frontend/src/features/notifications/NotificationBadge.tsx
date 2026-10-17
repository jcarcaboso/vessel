import { badgeText } from './unread'
import './notification-badge.css'

/** A red count of unread notifications. Decorative: the link it sits in carries the count in its name. */
export function NotificationBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className="notification-badge" aria-hidden="true">{badgeText(count)}</span>
}
