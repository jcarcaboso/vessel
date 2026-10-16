import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import './skeleton.css'

/** One placeholder bar. Size it with a class so it matches the text or control it stands in for. */
export function Skeleton({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-hidden="true" data-slot="skeleton" className={cn('skeleton', className)} {...props} />
}

/**
 * A first-load placeholder: announces `label` once as a status and hides the decorative rows from assistive
 * technology. Render it only after `useDelayedFlag`, so fast loads never flash.
 */
export function SkeletonStatus({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={cn('skeleton-status', className)} role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{children}</div>
  </div>
}
