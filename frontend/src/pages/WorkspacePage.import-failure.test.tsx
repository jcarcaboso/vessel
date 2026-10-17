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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(systemFixture))))
  render(<WorkspacePage />)
  await user.type(screen.getByLabelText('API token'), 'memory-only-token')
  await user.click(screen.getByRole('button', { name: 'Connect' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('The workspace could not be loaded.')
  expect(screen.queryByText(/private details/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reload browser' })).toBeEnabled()
})
