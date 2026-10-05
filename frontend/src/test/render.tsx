import { render as testingRender, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { VenuesProvider } from '@/api/venues'
import { systemFixture } from './system-fixture'

/** Renders with the venues of the shared system fixture, as the application shell provides them. */
export function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return testingRender(ui, { ...options, wrapper: ({ children }) => <VenuesProvider venues={systemFixture.venues}>{children}</VenuesProvider> })
}
