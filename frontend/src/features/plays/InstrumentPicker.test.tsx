import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceApi, type BrokerAccount, type InstrumentCatalog, type WorkspaceApi } from '@/api/workspace'
import { ApiError } from '@/api/system'
import { accountFixture, instrumentCatalogFixture } from '@/test/workspace-fixture'
import { InstrumentPicker } from './InstrumentPicker'

const wallet: BrokerAccount = { ...accountFixture, venueId: 'hyperliquid' }
function api() {
  return { ...createWorkspaceApi('test-only'), instruments: vi.fn().mockResolvedValue(instrumentCatalogFixture) }
}
function Harness({ account = wallet, client, onChange = vi.fn() }: {
  account?: BrokerAccount; client: WorkspaceApi; onChange?: (value: string, source: 'manual' | 'venue') => void
}) {
  const [selection, setSelection] = useState({ value: '', source: 'venue' as 'manual' | 'venue' })
  return <InstrumentPicker account={account} api={client} {...selection} onChange={(value, source) => {
    setSelection({ value, source }); onChange(value, source)
  }} />
}
function deferred() {
  let resolve!: (catalog: InstrumentCatalog) => void
  const promise = new Promise<InstrumentCatalog>(accept => { resolve = accept })
  return { promise, resolve }
}

describe('Venue instrument picker', () => {
  it('retrieves exact venue contract choices without defaulting to a sample instrument', async () => {
    const client = api(), onChange = vi.fn()
    render(<Harness client={client} onChange={onChange} />)
    await screen.findByRole('option', { name: '1000PEPE perpetual' })
    expect(client.instruments).toHaveBeenCalledWith(wallet.id, expect.any(AbortSignal))
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toHaveValue('')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Perpetual instrument' }), '1000PEPE')
    expect(onChange).toHaveBeenLastCalledWith('1000PEPE', 'venue')
    expect(screen.getByText(/Max 10×/)).toHaveAttribute('title', 'Catalogue maximum leverage. Full position validation is deferred.')
  })
  it('shows a disabled loading selector until metadata arrives', async () => {
    const request = deferred(), client = api()
    client.instruments.mockReturnValue(request.promise)
    render(<Harness client={client} />)
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => request.resolve(instrumentCatalogFixture))
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toBeEnabled()
  })
  it('offers safe retry and an explicit manual fallback after a failed read', async () => {
    const client = api()
    client.instruments.mockRejectedValueOnce(new ApiError('http', 'Catalogue unavailable.', 502))
    render(<Harness client={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalogue unavailable.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry instruments' }))
    await screen.findByRole('option', { name: 'BTC perpetual' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(client.instruments).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Enter manually' }))
    const input = screen.getByRole('textbox', { name: 'Perpetual instrument' })
    await userEvent.type(input, 'Custom contract')
    expect(input).toHaveValue('Custom contract')
    expect(screen.getByText(/Manual label/)).toBeInTheDocument()
  })
  it('does not read a venue for manual or disabled accounts', () => {
    const client = api()
    const view = render(<Harness client={client} account={accountFixture} />)
    expect(screen.getByRole('textbox', { name: 'Perpetual instrument' })).toBeEnabled()
    view.rerender(<Harness client={client} account={{ ...wallet, isEnabled: false }} />)
    expect(client.instruments).not.toHaveBeenCalled()
  })
  it('aborts the previous account read and ignores its late response', async () => {
    const first = deferred(), second = deferred(), client = api()
    client.instruments.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = render(<Harness client={client} />)
    const signal = client.instruments.mock.calls[0]![1] as AbortSignal
    view.rerender(<Harness client={client} account={{ ...wallet, id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' }} />)
    expect(signal.aborted).toBe(true)
    await act(async () => second.resolve({ ...instrumentCatalogFixture, instruments: [{ contractId: 'ETH', quantityDecimals: 4, maxLeverage: 20 }] }))
    await act(async () => first.resolve(instrumentCatalogFixture))
    expect(screen.getByRole('option', { name: 'ETH perpetual' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'BTC perpetual' })).not.toBeInTheDocument()
  })
  it('cancels metadata on unmount without invoking another request', () => {
    const client = api(), request = deferred()
    client.instruments.mockReturnValue(request.promise)
    const view = render(<Harness client={client} />)
    const signal = client.instruments.mock.calls[0]![1] as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(client.instruments).toHaveBeenCalledTimes(1)
  })
  it('rejects a catalogue from another venue instead of mislabelling it', async () => {
    const client = api()
    client.instruments.mockResolvedValue({ ...instrumentCatalogFixture, venueId: 'manual', scope: 'manual', instruments: [] })
    render(<Harness client={client} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match the selected venue')
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toBeDisabled()
  })
  it('keeps a removed contract visible as unverified rather than inventing its current availability', async () => {
    const client = api()
    render(<InstrumentPicker account={wallet} api={client} value="OLD" source="venue" onChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toBeEnabled())
    expect(screen.getByRole('option', { name: 'OLD · not in current catalogue' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Perpetual instrument' })).toHaveValue('OLD')
  })
})
