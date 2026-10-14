/**
 * The icon keys an owner can choose for a portfolio, in picker order. The server accepts only these keys;
 * keep them in step with `PortfolioIcons` in `backend/src/Vessel.Domain/Workspace/Portfolio.cs`.
 * Labels and drawn icons live in `features/workspace/portfolio-icons.ts`.
 */
export const portfolioIconKeys = [
  'folder', 'briefcase', 'wallet', 'piggy-bank', 'landmark', 'coins', 'bitcoin', 'gem',
  'trending-up', 'chart-line', 'chart-candlestick', 'chart-column', 'target', 'compass', 'rocket', 'zap',
  'flame', 'timer', 'hourglass', 'shield', 'anchor', 'mountain', 'sprout', 'crown',
] as const

export type PortfolioIconKey = typeof portfolioIconKeys[number]
export const defaultPortfolioIcon: PortfolioIconKey = 'folder'

export const isPortfolioIconKey = (key: unknown): key is PortfolioIconKey =>
  typeof key === 'string' && (portfolioIconKeys as readonly string[]).includes(key)
