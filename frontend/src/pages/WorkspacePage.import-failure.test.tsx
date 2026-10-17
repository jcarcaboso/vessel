import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { systemFixture } from '@/test/system-fixture'
import { WorkspacePage } from './WorkspacePage'

vi.mock('@/features/workspace/ApplicationShell', () => {
  throw new Error('Transient import failure with private details')
})

it('offers a reload, not a retry, when the workspace code cannot be loaded', async () => {
  const user = userEvent.setup()
  // Token mode: the page asks the server for its sign-in mode first.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) =>
    new Response(JSON.stringify(path.startsWith('/api/auth/config') ? { mode: 'token' } : systemFixture))))
  render(<WorkspacePage />)
  await user.type(await screen.findByLabelText('API token'), 'memory-only-token')
  await user.click(screen.getByRole('button', { name: 'Connect' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('The workspace could not be loaded.')
  expect(screen.queryByText(/private details/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload browser' })).toBeEnabled()
})
