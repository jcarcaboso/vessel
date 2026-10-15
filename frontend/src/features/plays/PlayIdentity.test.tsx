import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { render } from '@/test/render'
import { PlayIdentity } from './PlayIdentity'

describe('Play identity', () => {
  it('gives each fact its own encoding: ticker chip, venue logo and wallet account', () => {
    const { container } = render(<PlayIdentity instrument="ETH" source="venue" venueId="hyperliquid" accountName="Swing book" />)
    const chip = container.querySelector('.play-asset')!
    expect(chip).toHaveAttribute('title', 'ETH/USDC')
    expect(chip.querySelector('.play-asset-base')).toHaveTextContent('ETH')
    expect(chip.querySelector('.play-asset-quote')).toHaveTextContent('/USDC')
    expect(chip).toHaveTextContent('ETH/USDC')
    const account = container.querySelector('.play-account')!
    expect(within(account as HTMLElement).getByText('Swing book')).toHaveAttribute('title', 'Swing book')
    expect(account.querySelector('.play-account-icon')).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the venue from the registry as a tooltip and image label, never as text', () => {
    const { container } = render(<PlayIdentity instrument="ETH" source="venue" venueId="lighter-rh" accountName="Main" />)
    const logo = screen.getByRole('img', { name: 'Lighter · Robinhood' })
    expect(logo).toHaveAttribute('title', 'Lighter · Robinhood')
    expect(container).not.toHaveTextContent('Robinhood')
    // The quote asset also comes from the registry, not from the venue's name.
    expect(container.querySelector('.play-asset-quote')).toHaveTextContent('/USDG')
  })

  it('keeps a manual or unsourced instrument whole, without a quote', () => {
    const { container, rerender } = render(<PlayIdentity instrument="GDX" source="manual" venueId="manual" accountName="Broker" />)
    expect(container.querySelector('.play-asset')).toHaveTextContent(/^GDX$/)
    expect(container.querySelector('.play-asset-quote')).toBeNull()
    rerender(<PlayIdentity instrument="1000PEPE" venueId="hyperliquid" accountName="Broker" />)
    expect(container.querySelector('.play-asset')).toHaveTextContent(/^1000PEPE$/)
    expect(container.querySelector('.play-asset-quote')).toBeNull()
  })

  it('shows an empty marker without an instrument, and no logo without a venue', () => {
    const { container } = render(<PlayIdentity instrument="" accountName="Unknown account" />)
    expect(container.querySelector('.play-asset')).toHaveClass('is-empty')
    expect(container.querySelector('.play-asset')).toHaveTextContent('No instrument')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('Unknown account')
  })

  it('falls back to the venue id for an unregistered venue', () => {
    render(<PlayIdentity instrument="BTC" source="venue" venueId="retired-venue" accountName="Old" />)
    expect(screen.getByRole('img', { name: 'retired-venue' })).toBeInTheDocument()
  })
})
