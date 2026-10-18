import { useEffect, useState } from 'react'
import { discoverWallets, orderWallets, type BrowserWallet } from './discovery'

/** Browser wallets for as long as the caller is mounted, last used first; `settled` once the fallback wait ends. */
export function useBrowserWallets() {
  const [found, setFound] = useState<{ wallets: BrowserWallet[]; settled: boolean }>({ wallets: [], settled: false })
  useEffect(() => discoverWallets((wallets, settled) => setFound({ wallets: orderWallets(wallets), settled })), [])
  return found
}
