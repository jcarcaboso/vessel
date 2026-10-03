import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

/** Picks a venue contract in the searchable instrument field, e.g. "BTC" shown as BTC/USDC. */
export async function pickInstrument(user: { click(element: Element): Promise<void>; type(element: Element, text: string): Promise<void> }, contract: string) {
  const input = await screen.findByRole('combobox', { name: 'Perpetual instrument' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.click(input)
  await user.type(input, contract)
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${contract}/`) }))
}
