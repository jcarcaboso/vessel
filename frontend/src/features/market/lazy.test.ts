import { afterEach, expect, it, vi } from 'vitest'
import type { ChartCallbacks } from '@/components/chart/types'

const callbacks: ChartCallbacks = { onLevelSelect: vi.fn(), onLevelDrag: vi.fn(), onNeedOlder: vi.fn(), onDrawingCreate: vi.fn(),
  onDrawingChange: vi.fn(), onDrawingSelect: vi.fn(), onLevelEdit: vi.fn(), onPricePick: vi.fn(), onCrosshairMove: vi.fn(), onPaneLayout: vi.fn() }
afterEach(() => { vi.doUnmock('@/components/chart/lightweight'); vi.resetModules() })

it('preloads the renderer idempotently and shares the same import with adapters', async () => {
  const createLightweightAdapter = vi.fn().mockReturnValue({ setCandles: vi.fn(), destroy: vi.fn() })
  vi.doMock('@/components/chart/lightweight', () => ({ createLightweightAdapter }))
  const { preloadLightweightRenderer, createLazyLightweightAdapter } = await import('@/components/chart/lazy')
  const preload = preloadLightweightRenderer()
  expect(preloadLightweightRenderer()).toBe(preload)
  const adapter = createLazyLightweightAdapter(document.createElement('div'), callbacks)
  adapter.setCandles([], true)
  await preload
  await vi.waitFor(() => expect(createLightweightAdapter).toHaveBeenCalledTimes(1))
  adapter.destroy()
})

it('reports a rejected chunk import as an accessible chart error and cleans it up', async () => {
  vi.doMock('@/components/chart/lightweight', () => { throw new Error('Chunk unavailable') })
  const { preloadLightweightRenderer, createLazyLightweightAdapter } = await import('@/components/chart/lazy')
  const preload = preloadLightweightRenderer()
  const container = document.createElement('div')
  const adapter = createLazyLightweightAdapter(container, callbacks)
  await expect(preload).rejects.toThrow()
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reload the page'))
  expect(preloadLightweightRenderer()).toBe(preload)
  adapter.destroy()
  expect(container.childNodes).toHaveLength(0)
})

it('does not append an error after the waiting chart is destroyed', async () => {
  vi.doMock('@/components/chart/lightweight', () => { throw new Error('Chunk unavailable') })
  const { preloadLightweightRenderer, createLazyLightweightAdapter } = await import('@/components/chart/lazy')
  const container = document.createElement('div')
  const adapter = createLazyLightweightAdapter(container, callbacks)
  adapter.destroy()
  await expect(preloadLightweightRenderer()).rejects.toThrow()
  await Promise.resolve()
  expect(container.childNodes).toHaveLength(0)
})
