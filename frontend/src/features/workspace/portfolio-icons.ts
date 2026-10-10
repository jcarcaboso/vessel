import {
  Anchor, Bitcoin, Briefcase, ChartCandlestick, ChartColumn, ChartLine, Coins, Compass, Crown, Flame, Folder, Gem,
  Hourglass, Landmark, Mountain, PiggyBank, Rocket, Shield, Sprout, Target, Timer, TrendingUp, Wallet, Zap, type LucideIcon,
} from 'lucide-react'

/**
 * The icons an owner can choose for a portfolio, in picker order. The server accepts only these keys;
 * keep them in step with `PortfolioIcons` in `backend/src/Vessel.Domain/Workspace/Portfolio.cs`.
 */
export const portfolioIcons = {
  folder: { label: 'Folder', icon: Folder },
  briefcase: { label: 'Briefcase', icon: Briefcase },
  wallet: { label: 'Wallet', icon: Wallet },
  'piggy-bank': { label: 'Piggy bank', icon: PiggyBank },
  landmark: { label: 'Bank', icon: Landmark },
  coins: { label: 'Coins', icon: Coins },
  bitcoin: { label: 'Bitcoin', icon: Bitcoin },
  gem: { label: 'Gem', icon: Gem },
  'trending-up': { label: 'Trending up', icon: TrendingUp },
  'chart-line': { label: 'Line chart', icon: ChartLine },
  'chart-candlestick': { label: 'Candlesticks', icon: ChartCandlestick },
  'chart-column': { label: 'Column chart', icon: ChartColumn },
  target: { label: 'Target', icon: Target },
  compass: { label: 'Compass', icon: Compass },
  rocket: { label: 'Rocket', icon: Rocket },
  zap: { label: 'Lightning', icon: Zap },
  flame: { label: 'Flame', icon: Flame },
  timer: { label: 'Timer', icon: Timer },
  hourglass: { label: 'Hourglass', icon: Hourglass },
  shield: { label: 'Shield', icon: Shield },
  anchor: { label: 'Anchor', icon: Anchor },
  mountain: { label: 'Mountain', icon: Mountain },
  sprout: { label: 'Sprout', icon: Sprout },
  crown: { label: 'Crown', icon: Crown },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>

export type PortfolioIconKey = keyof typeof portfolioIcons
export const defaultPortfolioIcon: PortfolioIconKey = 'folder'
export const portfolioIconKeys = Object.keys(portfolioIcons) as PortfolioIconKey[]

export const isPortfolioIconKey = (key: unknown): key is PortfolioIconKey =>
  typeof key === 'string' && Object.hasOwn(portfolioIcons, key)

/** A stored key this browser does not know (or an older server without icons) shows the default folder. */
export const portfolioIconKey = (key: string | undefined): PortfolioIconKey => isPortfolioIconKey(key) ? key : defaultPortfolioIcon
