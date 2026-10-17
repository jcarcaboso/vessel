import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { systemFixture } from '@/test/system-fixture'
import { WorkspacePage } from './WorkspacePage'

const shell = vi.hoisted(() => {
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  return { loads: 0, ready, release }
})
vi.mock('@/features/workspace/ApplicationShell', async () => {
  shell.loads++
  await shell.ready
  return { ApplicationShell: ({ system }: { system: { owner: { displayName: string } } }) => <p>Shell for {system.owner.displayName}</p> }
})

it('starts loading the workspace on the connection screen and opens it once both are ready', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(systemFixture))))
  render(<WorkspacePage />)
  expect(screen.getByRole('heading', { name: 'Connect to your diary' })).toBeVisible()
  await vi.waitFor(() => expect(shell.loads).toBe(1))

  await user.type(screen.getByLabelText('API token'), 'memory-only-token')
  await user.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Loading your workspace…')

  shell.release()
  expect(await screen.findByText(`Shell for ${systemFixture.owner.displayName}`)).toBeVisible()
  expect(screen.queryByText('Loading your workspace…')).not.toBeInTheDocument()
  expect(shell.loads).toBe(1)
})
