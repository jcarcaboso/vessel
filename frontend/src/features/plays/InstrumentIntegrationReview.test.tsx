import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { createWorkspaceApi, type BrokerAccount } from '@/api/workspace'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { createDraft } from './draft'
import { PlayWorkspace } from './PlayWorkspace'

it('does not restore an obsolete portfolio filter when clearing an account after its portfolio changes', async () => {
  const api = createWorkspaceApi('test-only')
  function Harness({ accounts }: { accounts: BrokerAccount[] }) {
    const [draft, setDraft] = useState(() => ({
      ...createDraft(), accountId: accountFixture.id, instrument: 'Manual contract',
    }))
    return <PlayWorkspace accounts={accounts} portfolios={[portfolioFixture]} api={api}
      draft={draft} onChange={setDraft} />
  }

  const user = userEvent.setup()
  const view = render(<Harness accounts={[accountFixture]} />)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Portfolio' }), portfolioFixture.id)

  view.rerender(<Harness accounts={[{ ...accountFixture, portfolioId: null }]} />)
  expect(screen.getByRole('combobox', { name: 'Portfolio' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue(accountFixture.id)
  expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('Manual contract')

  await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), '')
  expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: 'Portfolio' })).toHaveValue('')
  expect(screen.getByRole('option', { name: 'Main account · Manual' })).toBeInTheDocument()
})
