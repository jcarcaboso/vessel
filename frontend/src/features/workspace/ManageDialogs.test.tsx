import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi, type WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { accountFixture, portfolioFixture } from '@/test/workspace-fixture'
import { ManageAccountDialog, ManagePortfolioDialog } from './ManageDialogs'

function client(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return { ...createWorkspaceApi('test-only-token'),
    renamePortfolio: vi.fn().mockResolvedValue(portfolioFixture), deletePortfolio: vi.fn().mockResolvedValue(undefined),
    updateAccount: vi.fn().mockResolvedValue(accountFixture), deleteAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
describe('Management dialogs', () => {
  it('renames only the portfolio without deleting its grouping', async () => {
    const api = client(), close = vi.fn(), changed = vi.fn()
    render(<ManagePortfolioDialog portfolio={portfolioFixture} api={api} onClose={close} onChanged={changed} />)
    const input = screen.getByLabelText('Portfolio name')
    await userEvent.clear(input); await userEvent.type(input, 'Intraday')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(api.renamePortfolio).toHaveBeenCalledWith(portfolioFixture.id, 'Intraday'))
    expect(api.deletePortfolio).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
  it('requires a second explicit portfolio-delete confirmation and explains retained accounts', async () => {
    const api = client()
    render(<ManagePortfolioDialog portfolio={portfolioFixture} api={api} onClose={vi.fn()} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.deletePortfolio).not.toHaveBeenCalled()
    expect(screen.getByText(/account records, imported executions, snapshots and plays are kept/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep portfolio' }))
    expect(api.deletePortfolio).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete portfolio' }))
    await waitFor(() => expect(api.deletePortfolio).toHaveBeenCalledWith(portfolioFixture.id))
  })
  it('saves rename, unlink and disable in a single settings request', async () => {
    const api = client(), close = vi.fn()
    render(<ManageAccountDialog account={accountFixture} portfolios={[portfolioFixture]} api={api} onClose={close} onChanged={vi.fn()} />)
    const input = screen.getByLabelText('Account name')
    await userEvent.clear(input); await userEvent.type(input, 'Hidden account')
    await userEvent.selectOptions(screen.getByLabelText('Portfolio'), '')
    await userEvent.click(screen.getByLabelText('Account enabled'))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith(accountFixture.id, {
      name: 'Hidden account', portfolioId: null, isEnabled: false,
    }))
    expect(api.deleteAccount).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
  it('moves a previously unassigned account into a selected portfolio', async () => {
    const api = client()
    render(<ManageAccountDialog account={{ ...accountFixture, portfolioId: null }} portfolios={[portfolioFixture]} api={api} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(screen.getByLabelText('Portfolio')).toHaveValue('')
    await userEvent.selectOptions(screen.getByLabelText('Portfolio'), portfolioFixture.id)
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith(accountFixture.id, {
      name: accountFixture.name, portfolioId: portfolioFixture.id, isEnabled: true,
    }))
  })
  it('enables a disabled account without changing its source data', async () => {
    const api = client()
    render(<ManageAccountDialog account={{ ...accountFixture, isEnabled: false }} portfolios={[portfolioFixture]} api={api} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(screen.getByLabelText('Account enabled')).not.toBeChecked()
    await userEvent.click(screen.getByLabelText('Account enabled'))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(api.updateAccount).toHaveBeenCalledWith(accountFixture.id, {
      name: accountFixture.name, portfolioId: portfolioFixture.id, isEnabled: true,
    }))
  })
  it('requires permanent-delete confirmation and retains dialog on a linked-play conflict', async () => {
    const api = client({ deleteAccount: vi.fn().mockRejectedValue(new ApiError('http', 'Account has linked plays. Disable it instead.', 409)) })
    const close = vi.fn()
    render(<ManageAccountDialog account={accountFixture} portfolios={[portfolioFixture]} api={api} onClose={close} onChanged={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.deleteAccount).not.toHaveBeenCalled()
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('linked plays')
    expect(close).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep account' })).toBeEnabled()
  })
  it('rejects an empty name before sending any update', async () => {
    const api = client()
    render(<ManageAccountDialog account={accountFixture} portfolios={[]} api={api} onClose={vi.fn()} onChanged={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText('Account name'))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name the account')
    expect(api.updateAccount).not.toHaveBeenCalled()
  })
})
