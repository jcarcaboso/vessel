import { StrictMode } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useObjectUrl } from './useObjectUrl'

beforeEach(() => {
  let next = 0
  vi.mocked(URL.createObjectURL).mockClear().mockImplementation(() => `blob:owned-${++next}`)
  vi.mocked(URL.revokeObjectURL).mockClear()
})
afterEach(() => { vi.mocked(URL.createObjectURL).mockImplementation(() => 'blob:test-image') })

describe('component-owned image URLs', () => {
  it('retains a lease for the same Blob, revokes on replacement, and revokes the replacement on unmount', () => {
    const blob = new Blob(['first'])
    const replacement = new Blob(['second'])
    const { result, rerender, unmount } = renderHook(({ blob }) => useObjectUrl(blob), { initialProps: { blob } })
    expect(result.current).toBe('blob:owned-1')
    rerender({ blob })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    rerender({ blob: replacement })
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-1')
    expect(result.current).toBe('blob:owned-2')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('reacquires after StrictMode cleanup, without retaining or displaying the revoked URL', () => {
    const blob = new Blob(['image'])
    const { result, unmount } = renderHook(() => useObjectUrl(blob), { wrapper: StrictMode })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-1')
    expect(result.current).toBe('blob:owned-2')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('allows two consumers of one Blob to release independently', () => {
    const blob = new Blob(['shared'])
    const thumbnail = renderHook(() => useObjectUrl(blob))
    const viewer = renderHook(() => useObjectUrl(blob))
    viewer.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned-2')
    expect(thumbnail.result.current).toBe('blob:owned-1')
    thumbnail.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1')
  })
})
