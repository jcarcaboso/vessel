import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { lazyPage } from './lazy-page'

it('does not promise import recovery when the browser can retain a rejected module URL', async () => {
  const load = vi.fn<() => Promise<{ default: () => React.JSX.Element }>>()
    .mockRejectedValueOnce(new Error('private import detail'))
    .mockResolvedValue({ default: () => <p>Available module</p> })
  const Page = lazyPage(load)
  const content = (route: string) => <PageErrorBoundary key={route}>
    <Suspense fallback={<p>Loading page</p>}><Page /></Suspense>
  </PageErrorBoundary>
  const view = render(content('review'), { onCaughtError: () => {} })

  expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be loaded.')
  expect(screen.queryByText('private import detail')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Return to Plays to save any unsaved work before reloading.')
  expect(screen.getByRole('alert')).toHaveTextContent('Reloading the browser discards unsaved work.')
  expect(screen.getByRole('button', { name: 'Reload browser' })).toBeEnabled()
  view.rerender(content('overview'))
  expect(await screen.findByRole('alert')).toHaveTextContent('This page could not be loaded.')
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Available module')).not.toBeInTheDocument()
})
