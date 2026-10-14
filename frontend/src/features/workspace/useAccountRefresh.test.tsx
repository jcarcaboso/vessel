import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi } from '@/api/workspace'
import { accountFixture } from '@/test/workspace-fixture'
import { useAccountRefresh } from './useAccountRefresh'

const accounts = [accountFixture, { ...accountFixture, id: 'second' }]

describe('account refresh session', () => {
  it.each(['cancel', 'unmount', 'API replacement'] as const)('suppresses rejected single refresh completion after %s', async action => {
    let reject!: (reason: Error) => void
    const api = { ...createWorkspaceApi('synthetic-only'), sync: vi.fn().mockImplementation(() => new Promise((_resolve, fail) => { reject = fail })) }
    const notify = vi.fn(), reload = vi.fn()
    const view = renderHook(({ api }) => useAccountRefresh({ api, refreshable: accounts, notify, reload }), { initialProps: { api } })
    let pending!: Promise<void>
    act(() => { pending = view.result.current.sync(accountFixture.id) })
    expect(view.result.current.refreshing).toBe(accountFixture.id)
    if (action === 'cancel') act(() => view.result.current.cancel())
    else if (action === 'unmount') view.unmount()
    else view.rerender({ api: { ...api, sync: vi.fn().mockResolvedValue(accountFixture) } })
    expect(api.sync.mock.calls[0]![1].aborted).toBe(true)
    await act(async () => { reject(new Error('late credential')); await pending })
    expect(notify).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('does not let an old batch clear or advance a new API refresh', async () => {
    let completeOld!: () => void, completeNew!: () => void
    const oldApi = { ...createWorkspaceApi('old-synthetic'), sync: vi.fn().mockImplementation(() => new Promise<void>(resolve => { completeOld = resolve })) }
    const nextApi = { ...oldApi, sync: vi.fn().mockImplementation(() => new Promise<void>(resolve => { completeNew = resolve })) }
    const notify = vi.fn(), reload = vi.fn()
    const { result, rerender } = renderHook(({ api }) => useAccountRefresh({ api, refreshable: accounts, notify, reload }), { initialProps: { api: oldApi } })
    let old!: Promise<void>, next!: Promise<void>
    act(() => { old = result.current.refreshAll() })
    rerender({ api: nextApi })
    act(() => { next = result.current.sync('new-account') })
    await act(async () => { completeOld(); await old })
    expect(oldApi.sync).toHaveBeenCalledTimes(1)
    expect(result.current.refreshing).toBe('new-account')
    expect(notify).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { completeNew(); await next })
    expect(result.current.refreshing).toBeNull()
    expect(notify).toHaveBeenCalledExactlyOnceWith({ tone: 'success', message: 'Account refreshed. Recent execution facts remain unassigned to plays.' })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
