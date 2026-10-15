import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceApi } from '@/api/workspace'
import { useSizing } from './useSizing'

describe('sizing document reads', () => {
  it('does not reread when the page is hidden, and catches up once with the latest generation when shown', async () => {
    const api = { sizing: vi.fn().mockResolvedValue({}) } as unknown as WorkspaceApi
    const view = renderHook(({ generation, enabled }) => useSizing(api, generation, enabled), { initialProps: { generation: 3, enabled: true } })
    await act(async () => {})
    expect(api.sizing).toHaveBeenCalledOnce()
    view.rerender({ generation: 3, enabled: false })
    view.rerender({ generation: 4, enabled: false })
    view.rerender({ generation: 5, enabled: false })
    await act(async () => {})
    expect(api.sizing).toHaveBeenCalledOnce()
    view.rerender({ generation: 5, enabled: true })
    await act(async () => {})
    expect(api.sizing).toHaveBeenCalledTimes(2)
    view.rerender({ generation: 5, enabled: false })
    view.rerender({ generation: 5, enabled: true })
    await act(async () => {})
    expect(api.sizing).toHaveBeenCalledTimes(2)
  })
})
