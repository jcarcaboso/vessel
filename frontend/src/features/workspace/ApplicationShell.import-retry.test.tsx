import { useEffect, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createWorkspaceApi } from '@/api/workspace'
import type { PlaysSession } from '@/features/plays/saved'
import { emptyOverview, playApiStubs } from '@/test/workspace-fixture'
import { systemFixture } from '@/test/system-fixture'
import { ApplicationShell } from './ApplicationShell'

const attempts = vi.hoisted(() => ({ review: 0, settings: 0, plays: 0, mounts: 0, unmounts: 0 }))
vi.mock('@/features/review/ReviewPage', () => {
  if (++attempts.review === 1) throw new Error('Transient import failure with private details')
  return { ReviewPage: () => <p>Recovered Review import</p> }
})
vi.mock('./SettingsPage', () => {
  if (++attempts.settings === 1) throw new Error('Transient Settings import failure')
  return { SettingsPage: () => <p>Recovered Settings import</p> }
})
vi.mock('@/features/plays/PlaysPage', () => {
  attempts.plays++
  return { PlaysPage: function TestPlays({ session, onSession }: {
    session: PlaysSession; onSession: (session: PlaysSession) => void
  }) {
    const [local, setLocal] = useState(0)
    useEffect(() => { attempts.mounts++; return () => { attempts.unmounts++ } }, [])
    return <><label>Draft title<input value={session.draft.title}
      onChange={event => onSession({ ...session, draft: { ...session.draft, title: event.target.value } })} /></label>
      <button onClick={() => setLocal(value => value + 1)}>Local owner {local}</button></>
  } }
})

it('retries rejected page imports on Try again and route revisit without replacing healthy hidden Plays or its draft', async () => {
  window.history.replaceState(null, '', '/#plays')
  const api = { ...createWorkspaceApi('synthetic-only'), ...playApiStubs(), overview: vi.fn().mockResolvedValue(emptyOverview) }
  const user = userEvent.setup()
  render(<ApplicationShell system={systemFixture} api={api} disconnect={vi.fn()} />, { onCaughtError: () => {} })
  await user.type(await screen.findByRole('textbox', { name: 'Draft title' }), 'Unsaved idea survives import failures')
  await user.click(screen.getByRole('button', { name: 'Local owner 0' }))

  await user.click(screen.getByRole('link', { name: 'Review' }))
  await screen.findByText('This page could not be displayed.')
  await act(async () => {})
  expect(attempts.review).toBe(1)
  expect(screen.queryByText(/private details/)).not.toBeInTheDocument()
  expect(attempts.unmounts).toBe(0)
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Recovered Review import')).toBeVisible()
  expect(attempts.review).toBe(2)

  await user.click(screen.getByRole('link', { name: 'Plays' }))
  expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Unsaved idea survives import failures')
  expect(screen.getByRole('button', { name: 'Local owner 1' })).toBeVisible()
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  await screen.findByText('This page could not be displayed.')
  expect(attempts.settings).toBe(1)
  await user.click(screen.getByRole('link', { name: 'Overview' }))
  await screen.findByText('Start with your accounts.')
  expect(attempts.settings).toBe(1)
  await user.click(screen.getByRole('link', { name: 'Settings' }))
  expect(await screen.findByText('Recovered Settings import')).toBeVisible()
  expect(attempts.settings).toBe(2)

  await user.click(screen.getByRole('link', { name: 'Review' }))
  expect(await screen.findByText('Recovered Review import')).toBeVisible()
  expect(attempts.review).toBe(2)
  await user.click(screen.getByRole('link', { name: 'Plays' }))
  expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('Unsaved idea survives import failures')
  expect(screen.getByRole('button', { name: 'Local owner 1' })).toBeVisible()
  expect(attempts.plays).toBe(1)
  expect(attempts.mounts).toBe(1)
  expect(attempts.unmounts).toBe(0)
})
