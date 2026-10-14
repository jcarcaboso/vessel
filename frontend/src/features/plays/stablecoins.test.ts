import { describe, expect, it } from 'vitest'
import { isNominalStablecoin, isNominalUsdQuote, nominalStablecoins } from './stablecoins'

describe('nominal stablecoins', () => {
  it('lists the backend nominal USD stablecoins, case-sensitive', () => {
    expect(nominalStablecoins).toEqual(['USDC', 'USDG', 'USDT', 'USDT0', 'USDE', 'USDe', 'USDH'])
    expect(isNominalStablecoin('USDG')).toBe(true)
    expect(isNominalStablecoin('usdg')).toBe(false)
    expect(isNominalStablecoin('PYUSD')).toBe(false)
    expect(isNominalStablecoin(null)).toBe(false)
  })

  it('treats USD and any listed stablecoin as a nominal USD quote', () => {
    for (const quote of ['USD', 'USDC', 'USDG', 'USDH']) expect(isNominalUsdQuote(quote)).toBe(true)
    for (const quote of ['EUR', 'usdc', '', undefined]) expect(isNominalUsdQuote(quote)).toBe(false)
  })
})
