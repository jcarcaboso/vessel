import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi, type BrokerAccount, type WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { VenuesProvider } from '@/api/venues'
import { credentialFixture, discoveryFixture, indexAccount, indexVenue } from '@/test/account-access-fixture'
import { portfolioFixture } from '@/test/workspace-fixture'
import { systemFixture } from '@/test/system-fixture'
import { CreateAccountDialog } from './CreateDialogs'

function client(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    ...createWorkspaceApi('test-only'),
    discoverAccounts: vi.fn().mockResolvedValue(discoveryFixture),
    createAccount: vi.fn().mockImplementation(body => Promise.resolve({
      ...indexAccount, ...body, id: body.sourceId === indexAccount.sourceId ? indexAccount.id : portfolioFixture.id,
    })),
    saveAccountCredential: vi.fn().mockResolvedValue(credentialFixture),
    sync: vi.fn(),
    ...overrides,
  }
}
function Fixture({ api, accounts = [] }: { api: WorkspaceApi; accounts?: BrokerAccount[] }) {
  const [open, setOpen] = useState(true)
  return <VenuesProvider venues={[indexVenue, ...systemFixture.venues.filter(v => v.id !== indexVenue.id)]}>
    <button onClick={() => setOpen(true)}>Open import</button>
    <CreateAccountDialog open={open} onOpenChange={setOpen} api={api} portfolios={[portfolioFixture]} accounts={accounts} onCreated={vi.fn()} />
  </VenuesProvider>
}
async function discover() {
  await userEvent.type(screen.getByLabelText('Public wallet address'), discoveryFixture.address)
  await userEvent.click(screen.getByRole('button', { name: 'Find wallet' }))
  await screen.findByRole('heading', { name: 'Choose accounts' })
}
async function selectMain() {
  await userEvent.click(screen.getByRole('checkbox', { name: /Main account.*9007199254740993/ }))
}

describe('Wallet account import', () => {
  it('discovers concrete indices, names selected accounts, assigns a portfolio and imports without refreshing history', async () => {
    const api = client()
    render(<Fixture api={api} />)
    await discover()
    expect(api.discoverAccounts).toHaveBeenCalledWith('lighter', discoveryFixture.address)
    expect(screen.getByText('Value unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled()
    await selectMain()
    const name = screen.getByLabelText(`Account name · ${indexAccount.sourceId}`)
    await userEvent.clear(name); await userEvent.type(name, 'Long-term')
    await userEvent.selectOptions(screen.getByLabelText(/Portfolio/), portfolioFixture.id)
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    await screen.findByText(/Imported. Public reads are available/)
    expect(api.createAccount).toHaveBeenCalledExactlyOnceWith({
      venueId: 'lighter', sourceId: '9007199254740993', name: 'Long-term', portfolioId: portfolioFixture.id,
    })
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
    expect(api.sync).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Main account.*9007199254740993/ })).toBeDisabled()
  })
  it('shows imported disabled accounts from discovery, and detects duplicates in the current workspace', async () => {
    const api = client({
      discoverAccounts: vi.fn().mockResolvedValue({ ...discoveryFixture, accounts: [
        { ...discoveryFixture.accounts[0], existingAccountId: indexAccount.id, isEnabled: false },
        discoveryFixture.accounts[1],
      ] }),
    })
    render(<Fixture api={api} accounts={[{ ...indexAccount, sourceId: discoveryFixture.accounts[1]!.sourceId, isEnabled: false }]} />)
    await discover()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    screen.getAllByRole('checkbox').forEach(box => expect(box).toBeDisabled())
    expect(screen.getAllByText(/Already imported · Disabled/)).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled()
    expect(api.createAccount).not.toHaveBeenCalled()
  })
  it('shows each partial result, keeps a created account after token failure, and continues with the next account', async () => {
    const secret = 'ro:never-echo-this'
    const api = client({ saveAccountCredential: vi.fn().mockRejectedValueOnce(new ApiError('http', secret)).mockResolvedValueOnce(credentialFixture) })
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    await userEvent.click(screen.getByRole('checkbox', { name: /Subaccount 1/ }))
    expect(screen.getByRole('link', { name: 'Create a read-only token in Lighter' })).toHaveAttribute('href', indexVenue.credentialSetupUrl)
    expect(screen.getByText(/For multiple selected accounts, create an all-scope token from the main account/)).toBeInTheDocument()
    const token = screen.getByLabelText('Read-only token')
    expect(token).toHaveAttribute('type', 'password')
    expect(token).toHaveAttribute('autocomplete', 'new-password')
    await userEvent.type(token, secret)
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (2)' }))
    await screen.findByText(/Imported, but token not saved/)
    await screen.findByText('Imported. Read-only token verified and saved.')
    expect(api.saveAccountCredential).toHaveBeenNthCalledWith(1, indexAccount.id, secret)
    expect(api.saveAccountCredential).toHaveBeenNthCalledWith(2, portfolioFixture.id, secret)
    expect(document.body).not.toHaveTextContent(secret)
    expect(screen.queryByLabelText('Read-only token')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).disabled)).toBe(true)
    expect(api.createAccount).toHaveBeenCalledTimes(2)
  })
  it('reports creation failure per account without hiding successful imports or blindly retrying', async () => {
    const api = client({ createAccount: vi.fn().mockRejectedValueOnce(new Error('unknown outcome')).mockResolvedValueOnce({
      ...indexAccount, sourceId: discoveryFixture.accounts[1]!.sourceId, id: portfolioFixture.id,
    }) })
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    await userEvent.click(screen.getByRole('checkbox', { name: /Subaccount 1/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (2)' }))
    await screen.findByText(/Import not confirmed. Find wallet again/)
    await screen.findByText(/Imported. Public reads are available/)
    expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).disabled)).toBe(true)
    expect(api.createAccount).toHaveBeenCalledTimes(2)
  })
  it('handles a duplicate created since discovery without attempting credential storage', async () => {
    const api = client({ createAccount: vi.fn().mockRejectedValue(new ApiError('http', 'duplicate', 409)) })
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:test-secret')
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    await screen.findByText(/Already added. Close this dialog/)
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Read-only token')).not.toBeInTheDocument()
  })
  it('clears the token on a failed name validation and when closing via Escape', async () => {
    const api = client()
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    await userEvent.clear(screen.getByLabelText(`Account name · ${indexAccount.sourceId}`))
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:test-secret')
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name each selected account')
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
    expect(api.createAccount).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:second-secret')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open import' }))
    await discover(); await selectMain()
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
  })
  it('clears the token when changing venues or wallet and never stores it', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem')
    const api = client()
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:secret')
    await userEvent.selectOptions(screen.getByLabelText('Venue'), 'manual')
    await userEvent.selectOptions(screen.getByLabelText('Venue'), 'lighter')
    await discover(); await selectMain()
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:secret')
    fireEvent.change(screen.getByLabelText('Public wallet address'), { target: { value: discoveryFixture.address.toUpperCase() } })
    expect(screen.queryByLabelText('Read-only token')).not.toBeInTheDocument()
    expect(local).not.toHaveBeenCalled()
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
  })
  it('still discovers and imports on LAN HTTP, but cannot enter or send a token', async () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: '192.168.1.5' })
    const api = client()
    render(<Fixture api={api} />)
    await discover(); await selectMain()
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    expect(screen.getByText(/Use HTTPS before entering/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }))
    await screen.findByText(/Imported. Public reads are available/)
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
  })
  it('requires a valid wallet and lets the owner retry a discovery failure', async () => {
    const api = client({ discoverAccounts: vi.fn().mockRejectedValueOnce(new Error('upstream')).mockResolvedValueOnce(discoveryFixture) })
    render(<Fixture api={api} />)
    await userEvent.click(screen.getByRole('button', { name: 'Find wallet' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid public wallet address')
    expect(api.discoverAccounts).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Public wallet address'), discoveryFixture.address)
    await userEvent.click(screen.getByRole('button', { name: 'Find wallet' }))
    await screen.findByText(/Could not find accounts/)
    await userEvent.click(screen.getByRole('button', { name: 'Find wallet' }))
    await screen.findByRole('heading', { name: 'Choose accounts' })
  })
  it('supports a direct index for a descriptor without discovery and does not treat it as a manual balance', async () => {
    const api = client()
    render(<VenuesProvider venues={[{ ...indexVenue, capabilities: { ...indexVenue.capabilities, accountDiscovery: false } }]}>
      <CreateAccountDialog open onOpenChange={vi.fn()} api={api} portfolios={[]} onCreated={vi.fn()} />
    </VenuesProvider>)
    await userEvent.type(screen.getByLabelText('Account name'), 'Indexed')
    await userEvent.type(screen.getByLabelText('Account index'), indexAccount.sourceId)
    expect(screen.queryByLabelText(/Known account value/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(api.createAccount).toHaveBeenCalledExactlyOnceWith({
      venueId: 'lighter', name: 'Indexed', sourceId: indexAccount.sourceId, portfolioId: null,
    }))
  })
})
