import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHashPage } from './useHashPage'

afterEach(() => window.history.replaceState(null, '', '/'))

describe('hash page routing', () => {
  it('defaults unknown hashes to Overview and accepts explicit and browser navigation', () => {
    window.history.replaceState(null, '', '/#unknown')
    const onNavigate = vi.fn()
    const { result, unmount } = renderHook(() => useHashPage(onNavigate))
    expect(result.current.page).toBe('overview')
    act(() => result.current.navigate('plays'))
    expect(result.current.page).toBe('plays')
    expect(window.location.hash).toBe('#plays')
    expect(onNavigate).toHaveBeenLastCalledWith('plays')
    act(() => {
      window.history.replaceState(null, '', '/#review')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current.page).toBe('review')
    expect(onNavigate).toHaveBeenLastCalledWith('review')
    unmount()
    onNavigate.mockClear()
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(onNavigate).not.toHaveBeenCalled()
  })
  it('opens the Notifications page from its hash', () => {
    window.history.replaceState(null, '', '/#notifications')
    const { result, unmount } = renderHook(() => useHashPage(vi.fn()))
    expect(result.current.page).toBe('notifications')
    unmount()
  })
})
