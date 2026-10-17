import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from 'radix-ui'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '@/api/workspace'
import type { InAppNotification, NotificationQuery } from '@/api/notifications'
import { ApiError } from '@/api/errors'
import { notificationReadAllConflict } from '@/api/notifications'
import { NotificationProvider } from '@/components/notifications/NotificationProvider'
import { VenuesProvider } from '@/api/venues'
import { systemFixture } from '@/test/system-fixture'
import { accountFixture } from '@/test/workspace-fixture'
import { notificationCursor, notificationFixture, notificationHeadFixture, notificationWith } from '@/test/notification-fixture'
import { NotificationsPage } from './NotificationsPage'
import { initialNotificationList, type NotificationListState } from './notification-list'
import type { InAppChange, InAppNotifications } from './useInAppNotifications'

function pageOf(items: InAppNotification[], query: NotificationQuery, totals: { unread?: number; all?: number; total?: number } = {}) {
  return { items, page: query.page, pageSize: query.pageSize, total: totals.total ?? items.length, unreadTotal: totals.unread ?? items.length, allTotal: totals.all ?? items.length }
}
function hub(cursor: string | null = notificationCursor(10)) {
  const listeners = new Set<(change: InAppChange) => void>()
  const inApp = {
    status: { known: true, unreadCount: 1, enabled: true, workerOnline: true, heartbeatAtUtc: null },
    handlers: { onHead: vi.fn(), onStatus: vi.fn(), onFrame: vi.fn() },
    cursor: vi.fn(() => cursor), acceptHead: vi.fn(),
    subscribe: (listener: (change: InAppChange) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    markRead: vi.fn((id: string) => Promise.resolve({ ...notificationFixture, id, state: 'read' as const, readAt: '2026-10-17T11:00:00Z' })),
    openLink: vi.fn(),
  } satisfies InAppNotifications
  return { inApp, emit: (change: InAppChange) => act(() => { for (const listener of listeners) listener(change) }) }
}
function renderPage(api: WorkspaceApi, inApp: InAppNotifications, initial: NotificationListState = initialNotificationList) {
  const onPreferences = vi.fn()
  const states: NotificationListState[] = []
  function Host() {
    const [state, setState] = useState(initial)
    states.push(state)
    return <NotificationsPage api={api} inApp={inApp} accounts={[accountFixture]} state={state} onStateChange={setState} eyebrow="Saturday" onPreferences={onPreferences} />
  }
  render(<Tooltip.Provider><NotificationProvider><VenuesProvider venues={systemFixture.venues}><main id="workspace-content" tabIndex={-1}><Host /></main></VenuesProvider></NotificationProvider></Tooltip.Provider>)
  return { onPreferences, states }
}

it('keeps focus when a read frame removes the focused Mark as read button', async () => {
  const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf([notificationWith(1)], query))) } as unknown as WorkspaceApi
  const { inApp, emit } = hub()
  renderPage(api, inApp)
  const row = (await screen.findByText('Notification 1')).closest('li')!
  act(() => within(row).getByRole('button', { name: 'Mark as read' }).focus())
  emit({ type: 'notification', notification: notificationWith(1, { state: 'read', readAt: '2026-10-17T11:00:00Z' }) })
  expect(document.activeElement).not.toBe(document.body)
})

it('rejects a page response started before the notification feed reset', async () => {
  let answer!: (page: ReturnType<typeof pageOf>) => void
  const api = { notifications: vi.fn(() => new Promise<ReturnType<typeof pageOf>>(resolve => { answer = resolve })) } as unknown as WorkspaceApi
  const { inApp, emit } = hub()
  renderPage(api, inApp)
  await waitFor(() => expect(api.notifications).toHaveBeenCalledOnce())
  emit({ type: 'reset' })
  await act(async () => { answer(pageOf([notificationWith(1)], { tab: 'unread', page: 1, pageSize: 25 })) })
  expect(screen.queryByText('Notification 1')).toBeNull()
})

describe('Notifications page', () => {
  it('lists rows with severity, account identity, time, pills, links and detail lines', async () => {
    const late = notificationWith(1, { severity: 'warning', content: { ...notificationFixture.content, late: true, lines: ['Line one', 'Line two'] } })
    const withdrawn = notificationWith(2, { state: 'withdrawn', content: { ...notificationFixture.content, subject: { ...notificationFixture.content.subject, accountId: null, accountName: 'Old account' } } })
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf(query.tab === 'all' ? [late, withdrawn] : [late], query, { unread: 1, all: 2 }))) } as unknown as WorkspaceApi
    const { inApp } = hub()
    renderPage(api, inApp)
    const row = (await screen.findByText('Notification 1')).closest('li')!
    expect(within(row).getByText('Warning')).toBeInTheDocument()
    expect(within(row).getByText('Late')).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: 'Unread' })).toBeInTheDocument()
    expect(within(row).getByText('Main account')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /ago|now/ })).toHaveAccessibleDescription(/2026/)
    expect(within(row).queryByText('Line one')).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Details' }))
    expect(within(row).getByText('Line one')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Open Play' }))
    expect(inApp.openLink).toHaveBeenCalledWith(notificationFixture.content.links[0], late.id)
    await userEvent.click(within(row).getByRole('button', { name: 'Mark as read' }))
    expect(inApp.markRead).toHaveBeenCalledWith(late.id)
    expect(screen.getByRole('tab', { name: /Unread\s*1/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /All\s*2/ }))
    const old = (await screen.findByText('Notification 2')).closest('li')!
    expect(within(old).getByText('No longer current')).toBeInTheDocument()
    expect(within(old).getByText('Old account')).toBeInTheDocument()
  })

  it('sends filters and paging to the server and keeps them in the shell state', async () => {
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf([notificationWith(1)], query, { total: 120, unread: 120, all: 130 }))) } as unknown as WorkspaceApi
    const { states } = renderPage(api, hub().inApp)
    await screen.findByText('Notification 1')
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'critical')
    await waitFor(() => expect(api.notifications).toHaveBeenLastCalledWith({ tab: 'unread', severity: 'critical', page: 1, pageSize: 25 }, expect.anything()))
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'links')
    await userEvent.click(await screen.findByRole('button', { name: '2' }))
    await waitFor(() => expect(api.notifications).toHaveBeenLastCalledWith({ tab: 'unread', category: 'links', severity: 'critical', page: 2, pageSize: 25 }, expect.anything()))
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '50')
    await waitFor(() => expect(states.at(-1)).toMatchObject({ page: 1, pageSize: 50, category: 'links', severity: 'critical' }))
  })

  it('shows empty states for both tabs', async () => {
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf([], query))) } as unknown as WorkspaceApi
    renderPage(api, hub().inApp)
    expect(await screen.findByText('You are all caught up. No unread notifications.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
    await userEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
  })

  it('updates rows from the stream at once and reloads, keeping focus off the body', async () => {
    let items = [notificationWith(1), notificationWith(2)]
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf(items, query))) } as unknown as WorkspaceApi
    const { inApp, emit } = hub()
    renderPage(api, inApp)
    const row = (await screen.findByText('Notification 1')).closest('li')!
    act(() => row.focus())
    items = [notificationWith(3), notificationWith(2)]
    emit({ type: 'notification', notification: { ...notificationWith(1), state: 'read', readAt: '2026-10-17T11:00:00Z' } })
    expect(within(row).queryByRole('img', { name: 'Unread' })).toBeNull()
    expect(await screen.findByText('Notification 3')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Notification 1')).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.closest('li')).not.toBeNull()
    expect(api.notifications).toHaveBeenCalledTimes(2)
  })

  it('marks all read up to the known cursor and reloads on a conflict so the owner can retry', async () => {
    const api = {
      notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf([notificationWith(1)], query))),
      readAllNotifications: vi.fn()
        .mockRejectedValueOnce(new ApiError('http', notificationReadAllConflict, 409))
        .mockResolvedValueOnce({ read: 1 }),
      notificationHead: vi.fn().mockResolvedValue(notificationHeadFixture),
    } as unknown as WorkspaceApi
    const { inApp } = hub()
    renderPage(api, inApp)
    await screen.findByText('Notification 1')
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(api.readAllNotifications).toHaveBeenCalledWith(notificationCursor(10))
    expect(await screen.findByRole('alert')).toHaveTextContent(notificationReadAllConflict)
    await waitFor(() => expect(inApp.acceptHead).toHaveBeenCalledWith(notificationHeadFixture))
    await waitFor(() => expect(api.notifications).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))
    expect(await screen.findByText('Marked 1 notification as read.')).toBeInTheDocument()
    expect(screen.queryByText(notificationReadAllConflict)).toBeNull()
  })

  it('reloads when the feed resets and links to Preferences', async () => {
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf([notificationWith(1)], query))) } as unknown as WorkspaceApi
    const { inApp, emit } = hub()
    const { onPreferences } = renderPage(api, inApp)
    await screen.findByText('Notification 1')
    emit({ type: 'reset' })
    await waitFor(() => expect(api.notifications).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('link', { name: 'Preferences' }))
    expect(onPreferences).toHaveBeenCalledOnce()
  })

  it('focuses the list panel when its last unread row disappears', async () => {
    let items = [notificationWith(1)]
    const api = { notifications: vi.fn((query: NotificationQuery) => Promise.resolve(pageOf(items, query))) } as unknown as WorkspaceApi
    const { inApp, emit } = hub()
    renderPage(api, inApp)
    const row = (await screen.findByText('Notification 1')).closest('li')!
    act(() => within(row).getByRole('button', { name: 'Mark as read' }).focus())
    items = []
    emit({ type: 'notification', notification: notificationWith(1, { state: 'read', readAt: '2026-10-17T11:00:00Z' }) })
    await screen.findByText('You are all caught up. No unread notifications.')
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Notification list' }))
  })
})
