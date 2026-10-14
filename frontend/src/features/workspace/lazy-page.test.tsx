import { Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { lazyPage } from './lazy-page'

it('leaves repeated import failures behind the boundary until another deliberate retry', async () => {
  const load = vi.fn<() => Promise<{ default: () => React.JSX.Element }>>()
    .mockRejectedValueOnce(new Error('private import detail'))
    .mockRejectedValueOnce(new Error('private import detail'))
    .mockResolvedValue({ default: () => <p>Loaded page</p> })
  const { Page, reset } = lazyPage(load)
  const user = userEvent.setup()
  render(<PageErrorBoundary onError={reset}>
    <Suspense fallback={<p>Loading page</p>}><Page /></Suspense>
  </PageErrorBoundary>, { onCaughtError: () => {} })

  await screen.findByRole('alert')
  await act(async () => {})
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('private import detail')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Some browser module errors require a reload.')
  await act(async () => {})
  expect(load).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Reload browser' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Loaded page')).toBeVisible()
  expect(load).toHaveBeenCalledTimes(3)
})
