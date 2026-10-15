import { vi } from 'vitest'

export function testFrames() {
  let id = 0
  const pending = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => pending.delete(id)))
  return {
    pending,
    run() {
      const frame = [...pending.values()]
      pending.clear()
      frame.forEach(callback => callback(0))
    },
  }
}
