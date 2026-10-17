import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationProvider } from './NotificationProvider'
import { useNotifications, type NotificationInput } from './notifications'

function Trigger({ input, label }: { input: NotificationInput; label: string }) {
  const { notify } = useNotifications()
  return <button type="button" onClick={() => notify(input)}>{label}</button>
}
function Withdraw({ id }: { id: string }) {
  const { dismiss } = useNotifications()
  return <button type="button" onClick={() => dismiss(id, 'withdrawn')}>withdraw {id}</button>
}

let visibility: DocumentVisibilityState = 'visible'
let focused = true
function setActive(next: { visible?: boolean; focused?: boolean }) {
  if (next.visible !== undefined) visibility = next.visible ? 'visible' : 'hidden'
  if (next.focused !== undefined) focused = next.focused
  act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(focused ? 'focus' : 'blur')) })
}
beforeEach(() => {
  visibility = 'visible'; focused = true
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('popup notifications', () => {
  it('mounts both live regions before notifications and preserves them through replacement and dismissal', async () => {
    const { container } = render(<NotificationProvider><Trigger label="first" input={{ message: 'First' }} />
      <Trigger label="error" input={{ tone: 'error', message: 'Failure' }} /></NotificationProvider>)
    const regions = [...container.querySelectorAll('[aria-live]')]
    expect(regions.filter(region => region.getAttribute('aria-live') === 'polite')).toHaveLength(4)
    expect(regions.filter(region => region.getAttribute('aria-live') === 'assertive')).toHaveLength(4)
    for (const region of regions) expect(region).toBeEmptyDOMElement()
    await userEvent.click(screen.getByRole('button', { name: 'first' }))
    await userEvent.click(screen.getByRole('button', { name: 'error' }))
    expect(screen.getByRole('status').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('alert').closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive')
    const dismiss = screen.getAllByRole('button', { name: 'Dismiss notification' })
    await userEvent.click(dismiss[0]!)
    await userEvent.click(dismiss[1]!)
    expect([...container.querySelectorAll('[aria-live]')]).toEqual(regions)
    for (const region of regions) expect(region).toBeEmptyDOMElement()
  })

  it('stacks notifications, replaces one with the same key and closes on dismiss', async () => {
    const user = userEvent.setup()
    render(<NotificationProvider>
      <Trigger label="first" input={{ tone: 'error', key: 'save', message: 'Save failed' }} />
      <Trigger label="second" input={{ tone: 'error', key: 'save', title: 'Not saved', message: 'Still failing' }} />
      <Trigger label="done" input={{ tone: 'success', message: 'Saved' }} />
    </NotificationProvider>)
    await user.click(screen.getByRole('button', { name: 'first' }))
    await user.click(screen.getByRole('button', { name: 'second' }))
    await user.click(screen.getByRole('button', { name: 'done' }))
    expect(screen.getAllByRole('alert').map(item => item.textContent)).toEqual(['Not savedStill failing'])
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    await user.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]!)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes after its duration unless hovered, and keeps sticky ones', async () => {
    vi.useFakeTimers()
    render(<NotificationProvider>
      <Trigger label="brief" input={{ message: 'Brief', duration: 1000 }} />
      <Trigger label="sticky" input={{ message: 'Sticky', duration: null }} />
    </NotificationProvider>)
    act(() => { screen.getByRole('button', { name: 'brief' }).click(); screen.getByRole('button', { name: 'sticky' }).click() })
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.queryByText('Brief')).toBeNull()
    expect(screen.getByText('Sticky')).toBeInTheDocument()
  })

  it('reports why each popup closed, exactly once', async () => {
    vi.useFakeTimers()
    const closed: string[] = []
    const input = (name: string, extra: Partial<NotificationInput> = {}): NotificationInput =>
      ({ message: name, duration: null, onClose: reason => closed.push(`${name}:${reason}`), ...extra })
    render(<NotificationProvider>
      <Trigger label="keyed" input={input('keyed', { key: 'k' })} />
      <Trigger label="rekeyed" input={input('rekeyed', { key: 'k' })} />
      <Trigger label="timed" input={input('timed', { duration: 1000 })} />
      <Trigger label="acted" input={input('acted', { action: { label: 'Open', onClick: () => undefined } })} />
      <Trigger label="plain" input={input('plain')} />
      <Withdraw id="w" />
      <Trigger label="withdrawn" input={input('withdrawn', { key: 'w' })} />
    </NotificationProvider>)
    const click = (name: string) => act(() => { screen.getByRole('button', { name }).click() })
    click('keyed'); click('rekeyed')
    expect(closed).toEqual(['keyed:replaced'])
    click('timed')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(closed).toContain('timed:timeout')
    click('acted')
    click('Open')
    expect(closed).toContain('acted:action')
    click('withdrawn'); click('withdraw w')
    expect(closed).toContain('withdrawn:withdrawn')
    click('plain')
    act(() => { screen.getAllByRole('button', { name: 'Dismiss notification' }).at(-1)!.click() })
    expect(closed).toContain('plain:dismissed')
    // A full stack pushes out its oldest popup.
    for (const name of ['acted', 'acted', 'acted', 'acted']) click(name)
    expect(closed).toContain('rekeyed:evicted')
    expect(closed.filter(entry => entry.startsWith('rekeyed:'))).toHaveLength(1)
  })

  it('shows a polite warning tone and an accessible close label', async () => {
    render(<NotificationProvider><Trigger label="warn" input={{ tone: 'warning', title: 'Stale', message: 'Check it', closeLabel: 'Mark as read and close' }} /></NotificationProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'warn' }))
    const popup = screen.getByRole('status')
    expect(popup).toHaveClass('is-warning')
    expect(popup.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Mark as read and close' })).toBeInTheDocument()
  })

  it('runs a visible-focused timer only while the tab is visible and focused', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<NotificationProvider><Trigger label="gated" input={{ message: 'Gated', duration: 6000, timer: 'visible-focused', onClose }} />
      <Trigger label="plain" input={{ message: 'Plain', duration: 6000 }} /></NotificationProvider>)
    setActive({ focused: false })
    act(() => { screen.getByRole('button', { name: 'gated' }).click(); screen.getByRole('button', { name: 'plain' }).click() })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Gated')).toBeInTheDocument()
    expect(screen.queryByText('Plain')).toBeNull()
    setActive({ focused: true, visible: false })
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.getByText('Gated')).toBeInTheDocument()
    setActive({ visible: true })
    act(() => { vi.advanceTimersByTime(5999) })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onClose).toHaveBeenCalledWith('timeout')
  })

  it('moves focus from a closing popup to the next one, then to the page content', async () => {
    render(<><main id="workspace-content" tabIndex={-1}>Page</main><NotificationProvider>
      <Trigger label="one" input={{ message: 'One', key: 'one', duration: null }} />
      <Trigger label="two" input={{ message: 'Two', key: 'two', duration: null }} />
      <Withdraw id="one" /><Withdraw id="two" />
    </NotificationProvider></>)
    await userEvent.click(screen.getByRole('button', { name: 'one' }))
    await userEvent.click(screen.getByRole('button', { name: 'two' }))
    const [first] = screen.getAllByRole('button', { name: 'Dismiss notification' })
    act(() => first!.focus())
    act(() => { screen.getByRole('button', { name: 'withdraw one' }).click() })
    expect(document.activeElement).toBe(screen.getByText('Two').closest('.notification'))
    act(() => { screen.getByRole('button', { name: 'withdraw two' }).click() })
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})
