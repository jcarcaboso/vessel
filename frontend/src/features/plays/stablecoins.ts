/**
 * USD stablecoins counted at nominal value: one token is one USD, with no FX or depeg valuation.
 * Kept in step with the backend `NominalStablecoins.Symbols`; a backend test guards that the lists match.
 * Symbols are case-sensitive, exactly as venues report them.
 */
export const nominalStablecoins = ['USDC', 'USDG', 'USDT', 'USDT0', 'USDE', 'USDe', 'USDH'] as const

export const isNominalStablecoin = (symbol: string | null | undefined): boolean =>
  !!symbol && (nominalStablecoins as readonly string[]).includes(symbol)

/** A quote that a nominal USD risk reference can use: USD itself or a listed stablecoin. */
export const isNominalUsdQuote = (quote: string | null | undefined): boolean => quote === 'USD' || isNominalStablecoin(quote)
