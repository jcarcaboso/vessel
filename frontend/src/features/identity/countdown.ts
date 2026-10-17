import { useEffect, useState } from 'react'

/** Remaining seconds until `expiresAt`, measured from the message's own issue time so a skewed clock cannot shorten it. */
export function challengeLifetime(message: string, expiresAt: string, now = Date.now()) {
  const issued = Date.parse(/^Issued At: (.+)$/m.exec(message)?.[1] ?? '')
  const expires = Date.parse(expiresAt)
  const total = Number.isFinite(issued) && Number.isFinite(expires) ? expires - issued : expires - now
  return Math.max(0, Math.min(10 * 60_000, Number.isFinite(total) ? total : 0))
}

export function useCountdown(lifetimeMs: number | null, onExpired: () => void) {
  const [deadline] = useState(() => lifetimeMs === null ? null : Date.now() + lifetimeMs)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (time >= deadline) onExpired()
    }
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [deadline, onExpired])
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
