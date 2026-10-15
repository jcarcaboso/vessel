import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import './native-select.css'

type NativeSelectProps = Omit<ComponentProps<'select'>, 'multiple' | 'size'> & {
  /** `compact` is 32px, level with a small button; `bare` drops border and background for dense field bars. Default is 36px, level with Input and Button. */
  density?: 'compact' | 'bare'
}

/**
 * The one dropdown for the whole app. It keeps the native select, so keyboard, option lists, labels and
 * `<optgroup>` behave as usual, and draws a single chevron at one inset so the arrow never depends on browser chrome.
 * Wrapping it in a `<label>` still labels the select; `className` and every other prop go to the `<select>`.
 */
export function NativeSelect({ density, ...props }: NativeSelectProps) {
  return <span className="native-select" data-density={density}>
    <select {...props} data-slot="native-select" />
    <ChevronDown size={14} aria-hidden="true" />
  </span>
}
