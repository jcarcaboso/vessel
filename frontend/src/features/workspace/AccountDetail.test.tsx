import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/render'
import { accountFixture } from '@/test/workspace-fixture'
import type { WorkspaceApi } from '@/api/workspace'
import { AccountDetail } from './AccountDetail'

vi.mock('./ActivityOperations', () => ({ ActivityOperations: () => null }))

// The snapshot read stays pending: the value caption comes from the account record and venue descriptor.
const api = { snapshot: vi.fn(() => new Promise(() => {})) } as unknown as WorkspaceApi
const detail = (venueId: string, syncStatus: 'synced' | 'manual') => render(<AccountDetail account={{ ...accountFixture, venueId, syncStatus, sourceId: venueId === 'manual' ? null : '7' }}
  api={api} refreshing={false} onSync={vi.fn()} onBack={vi.fn()} onManage={vi.fn()} />)

describe('Account detail value unit', () => {
  it('states the venue quote stablecoin for a venue-reported value', () => {
    detail('lighter-rh', 'synced')
    expect(screen.getByText('Account value · reported')).toBeInTheDocument()
    // The caption is a short source pill named by its visible text, with the full description as its description.
    expect(screen.getByRole('button', { name: 'USDG' })).toHaveTextContent(/^USDG$/)
    expect(screen.getByRole('button', { name: 'USDG' })).toHaveAccessibleDescription('Perpetuals equity in USDG · nominal')
    expect(screen.getByText('$1,250.12')).toBeInTheDocument()
  })
  it('keeps manual values as entered', () => {
    detail('manual', 'manual')
    expect(screen.getByText('Known manual value')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'manual' })).toHaveAccessibleDescription('Entered manually')
  })
})
