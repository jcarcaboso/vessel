import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationProvider } from './NotificationProvider'
import { useNotifications, type NotificationInput } from './notifications'

function Trigger({ input, label }: { input: NotificationInput; label: string }) {
  const { notify } = useNotifications()
  return <button type="button" onClick={() => notify(input)}>{label}</button>
}

afterEach(() => vi.useRealTimers())

describe('popup notifications', () => {
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
})
