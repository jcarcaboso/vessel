import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import './native-select.css'

/** Keep native keyboard, option and label behaviour; position the arrow independently of browser chrome. */
export function NativeSelect(props: Omit<ComponentProps<'select'>, 'multiple' | 'size'>) {
  return <span className="native-select">
    <select {...props} data-slot="native-select" />
    <ChevronDown size={14} aria-hidden="true" />
  </span>
}
