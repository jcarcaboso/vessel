import { render as testingRender, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Tooltip } from 'radix-ui'
import { VenuesProvider } from '@/api/venues'
import { systemFixture } from './system-fixture'

/** Standalone components get the shell's tooltip timings and shared fixture venues. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return testingRender(ui, { ...options, wrapper: ({ children }) => <Tooltip.Provider delayDuration={250} skipDelayDuration={400}><VenuesProvider venues={systemFixture.venues}>{children}</VenuesProvider></Tooltip.Provider> })
}
