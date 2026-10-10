import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionGate } from './ConnectionGate'
import { systemFixture } from '@/test/system-fixture'

function renderGate() {
  return render(<ConnectionGate>{(system, disconnect) => <div>Connected to {system.application}<button onClick={disconnect}>Disconnect</button></div>}</ConnectionGate>)
}

describe('runtime connection gate', () => {
  it('blocks the workspace when the token is missing', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    renderGate()
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your Vessel API token')
    expect(request).not.toHaveBeenCalled()
    expect(screen.queryByText('Connected to Vessel')).not.toBeInTheDocument()
  })

  it('verifies the API, clears the input, and disconnects without persisted secrets', async () => {
    const user = userEvent.setup()
    const localWrite = vi.spyOn(Storage.prototype, 'setItem')
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(systemFixture)))
    vi.stubGlobal('fetch', request)
    renderGate()
    await user.type(screen.getByLabelText('API token'), 'memory-only-token')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Connected to Vessel')).toBeInTheDocument()
    expect(localWrite).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain('memory-only-token')
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(screen.getByLabelText('API token')).toHaveValue('')
    expect(screen.queryByText('Connected to Vessel')).not.toBeInTheDocument()
  })

  it('explains a temporary lockout after too many wrong tokens', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '600' } })))
    renderGate()
    await user.type(screen.getByLabelText('API token'), 'guess')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many wrong tokens from this device')
    expect(screen.getByLabelText('API token')).toHaveValue('')
  })

  it('shows wrong-token errors, clears the rejected token and allows retry', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(systemFixture)))
    vi.stubGlobal('fetch', request)
    renderGate()
    await user.type(screen.getByLabelText('API token'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('rejected this token')
    expect(screen.getByLabelText('API token')).toHaveValue('')
    await user.type(screen.getByLabelText('API token'), 'correct')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Connected to Vessel')).toBeInTheDocument()
  })

  it('reports API-unavailable state and never displays sample content on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderGate()
    await userEvent.type(screen.getByLabelText('API token'), 'token')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('API is unavailable')
    expect(screen.queryByText('Connected to Vessel')).not.toBeInTheDocument()
  })

  it('disables duplicate connection requests while one is pending', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    renderGate()
    await userEvent.type(screen.getByLabelText('API token'), 'token')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    expect(screen.getByLabelText('API token')).toBeDisabled()
    resolve(new Response(JSON.stringify(systemFixture)))
    await waitFor(() => expect(screen.getByText('Connected to Vessel')).toBeInTheDocument())
  })
})
