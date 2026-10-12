import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import './activity-operations.css'

export function OperationDirection({ direction }: { direction: 'long' | 'short' | null }) {
  const Icon = direction === 'long' ? ArrowUp : direction === 'short' ? ArrowDown : ArrowUpDown
  return <span className={`workspace-badge operation-direction ${direction ?? 'unknown'}`}><Icon size={14} aria-hidden="true" />{direction === 'long' ? 'Long' : direction === 'short' ? 'Short' : 'Unknown'}</span>
}
