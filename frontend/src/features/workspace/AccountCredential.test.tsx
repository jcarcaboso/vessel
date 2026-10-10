import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { credentialSaveMessage } from '@/api/account-access'
import { createWorkspaceApi, type WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { VenuesProvider } from '@/api/venues'
import { credentialFixture, indexAccount, indexVenue } from '@/test/account-access-fixture'
import { ManageAccountDialog } from './ManageDialogs'

function client(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    ...createWorkspaceApi('test-only'),
    accountCredential: vi.fn().mockResolvedValue(credentialFixture),
    saveAccountCredential: vi.fn().mockResolvedValue(credentialFixture),
    deleteAccountCredential: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn().mockResolvedValue(indexAccount),
    ...overrides,
  }
}
function Fixture({ api, enabled = true }: { api: WorkspaceApi; enabled?: boolean }) {
  const [open, setOpen] = useState(true)
  return <VenuesProvider venues={[indexVenue]}>
    <button onClick={() => setOpen(true)}>Open management</button>
    {open && <ManageAccountDialog account={{ ...indexAccount, isEnabled: enabled }} portfolios={[]} api={api} onClose={() => setOpen(false)} onChanged={vi.fn()} />}
  </VenuesProvider>
}

describe('Account credential management', () => {
  it.each(['valid', 'expiring', 'expired', 'unavailable'] as const)('shows %s metadata, expiry and exact source identity', async status => {
    const api = client({ accountCredential: vi.fn().mockResolvedValue({
      ...credentialFixture, credential: { ...credentialFixture.credential, status },
    }) })
    render(<Fixture api={api} />)
    await screen.findByText(status[0]!.toUpperCase() + status.slice(1))
    expect(screen.getByText('Expires')).toBeInTheDocument()
    expect(screen.getByText(/2027/)).toBeInTheDocument()
    expect(screen.getByText('All accounts · verified for this account')).toBeInTheDocument()
    expect(screen.getByText(/9007199254740993/)).toBeInTheDocument()
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
  })
  it('shows Missing and verifies a token without submitting account settings', async () => {
    const api = client({ accountCredential: vi.fn().mockResolvedValue({ storageConfigured: true, credential: null }) })
    render(<Fixture api={api} />)
    await screen.findByText('Missing')
    const setup = screen.getByRole('link', { name: 'Create a read-only token in Lighter' })
    expect(setup).toHaveAttribute('href', 'https://app.lighter.xyz/read-only-tokens')
    expect(setup).toHaveAttribute('target', '_blank')
    expect(setup).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/Do not enter API private keys/)).toBeInTheDocument()
    expect(screen.getByText(/Choose single scope for this account/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:test-only')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and save token' }))
    await screen.findByText('Read-only token verified and saved.')
    expect(api.saveAccountCredential).toHaveBeenCalledExactlyOnceWith(indexAccount.id, 'ro:test-only')
    expect(api.updateAccount).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
    expect(screen.getByText('Valid')).toBeInTheDocument()
  })
  it('clears the secret immediately on replacement, does not echo API errors, and clears it on close', async () => {
    let reject: (cause: Error) => void = () => {}
    const api = client({ saveAccountCredential: vi.fn().mockImplementation(() => new Promise((_resolve, no) => { reject = no })) })
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const log = vi.spyOn(console, 'log')
    render(<Fixture api={api} />)
    await screen.findByText('Valid')
    const field = screen.getByLabelText('Read-only token')
    await userEvent.type(field, 'ro:test-only-secret')
    await userEvent.click(screen.getByRole('button', { name: 'Verify and replace token' }))
    expect(field).toHaveValue('')
    expect(field).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
    reject(new ApiError('http', 'ro:test-only-secret'))
    await screen.findByText(credentialSaveMessage)
    expect(document.body).not.toHaveTextContent('ro:test-only-secret')
    expect(field).toHaveValue('')
    expect(storage).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    await userEvent.type(field, 'ro:another-secret')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open management' }))
    await screen.findByText('Valid')
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
  })
  it('requires removal confirmation and preserves the account', async () => {
    const api = client()
    render(<Fixture api={api} />)
    await screen.findByText('Valid')
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:unsaved')
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    expect(screen.queryByLabelText('Read-only token')).not.toBeInTheDocument()
    expect(api.deleteAccountCredential).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Keep token' }))
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove token' }))
    await screen.findByText('Credential removed. Public account reads remain available.')
    expect(api.deleteAccountCredential).toHaveBeenCalledExactlyOnceWith(indexAccount.id)
    expect(api.updateAccount).not.toHaveBeenCalled()
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })
  it('shows operator guidance for an unconfigured vault, while allowing credential removal without a key', async () => {
    const api = client({ accountCredential: vi.fn().mockResolvedValue({ ...credentialFixture, storageConfigured: false }) })
    render(<Fixture api={api} />)
    await screen.findByText(/Credential storage is not configured/)
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verify and replace token' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove token' }))
    await screen.findByText(/Credential removed/)
    expect(api.deleteAccountCredential).toHaveBeenCalledOnce()
  })
  it('requires a disabled account to be enabled and saved before token replacement, but permits removal', async () => {
    const api = client()
    render(<Fixture api={api} enabled={false} />)
    await screen.findByText('Valid')
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    expect(screen.getByText(/Enable the account and save its settings/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Account enabled' }))
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove token' }))
    await screen.findByText(/Credential removed/)
    expect(api.deleteAccountCredential).toHaveBeenCalledOnce()
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
  })
  it('shows unavailable and retries metadata without exposing raw errors', async () => {
    const api = client({ accountCredential: vi.fn().mockRejectedValueOnce(new Error('raw-provider')).mockResolvedValueOnce(credentialFixture) })
    render(<Fixture api={api} />)
    await screen.findByText('Credential status is unavailable. Retry to check it.')
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    expect(document.body).not.toHaveTextContent('raw-provider')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh credential status' }))
    await screen.findByText('Valid')
    expect(screen.getByLabelText('Read-only token')).toBeEnabled()
  })
  it('blocks entry and replacement over LAN HTTP while still showing status and allowing removal', async () => {
    vi.stubGlobal('location', { protocol: 'http:', hostname: 'vessel.local' })
    const api = client()
    render(<Fixture api={api} />)
    await screen.findByText('Valid')
    expect(screen.getByLabelText('Read-only token')).toBeDisabled()
    expect(screen.getByText(/Use HTTPS before entering/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify and replace token' })).toBeDisabled()
    expect(api.saveAccountCredential).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    expect(screen.getByRole('button', { name: 'Confirm remove token' })).toBeEnabled()
  })
  it('clears unsaved token text on explicit metadata refresh', async () => {
    const api = client()
    render(<Fixture api={api} />)
    await screen.findByText('Valid')
    await userEvent.type(screen.getByLabelText('Read-only token'), 'ro:unsaved')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh credential status' }))
    await waitFor(() => expect(api.accountCredential).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Read-only token')).toHaveValue('')
  })
})
