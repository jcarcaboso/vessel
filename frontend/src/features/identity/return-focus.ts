/** The focused control, if any; the body does not count. */
export function focusedControl(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * `onCloseAutoFocus` for a dialog opened from state rather than its own Radix trigger, which Radix would otherwise
 * send to the body. Focus goes to the first target still on the page; with none, Radix's default runs.
 */
export function returnFocus(...targets: Array<() => HTMLElement | null | undefined>) {
  return (event: Event) => {
    for (const target of targets) {
      const element = target()
      if (!element?.isConnected) continue
      event.preventDefault()
      element.focus()
      return
    }
  }
}

/** The topmost dialog still open, e.g. the one a nested step-up was opened over. */
export const openDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)
