import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeframeBar } from './TimeframeBar'

describe('timeframe bar', () => {
  it('offers only the intervals the venue serves', async () => {
    const user = userEvent.setup()
    render(<TimeframeBar value="1h" favorites={['3m', '1h', '4h']} available={['1m', '1h', '4h', '1d']} onChange={vi.fn()} onFavoritesChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '1 hour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4 hours' })).toBeInTheDocument()
    // 3m is a favorite but this venue does not serve it.
    expect(screen.queryByRole('button', { name: '3 minutes' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All timeframes' }))
    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.queryByText('2 hours')).not.toBeInTheDocument()
  })
})
