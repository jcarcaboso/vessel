import { useSyncExternalStore } from 'react'
import { isHexColor, mix, themeById, themes, type Theme, type ThemeColorKey, type ThemeColors } from './themes'

/**
 * The owner's theme choice and per-theme colour overrides. Appearance is a browser preference, not workspace
 * data, so it lives in localStorage and survives disconnecting; it never holds anything sensitive.
 */
export interface Appearance {
  themeId: string
  /** Overrides keyed by theme, so tweaking one theme leaves the others untouched. */
  custom: Record<string, ThemeOverrides>
}

export interface ThemeOverrides {
  colors?: Partial<ThemeColors> | undefined
  radius?: number | undefined
}

export const storageKey = 'vessel.appearance'
export const radiusRange = { min: 0, max: 14 } as const

const colorKeys = Object.keys(themes[0]!.colors) as ThemeColorKey[]

const sanitizeOverrides = (value: unknown): ThemeOverrides | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as { colors?: unknown; radius?: unknown }
  const overrides: ThemeOverrides = {}
  if (raw.colors && typeof raw.colors === 'object') {
    const colors = Object.fromEntries(colorKeys.flatMap(key => {
      const color = (raw.colors as Record<string, unknown>)[key]
      return isHexColor(color) ? [[key, color.toLowerCase()]] : []
    }))
    if (Object.keys(colors).length) overrides.colors = colors
  }
  if (typeof raw.radius === 'number' && Number.isInteger(raw.radius) && raw.radius >= radiusRange.min && raw.radius <= radiusRange.max) overrides.radius = raw.radius
  return overrides.colors || overrides.radius !== undefined ? overrides : null
}

/** Reads the stored preference, dropping anything unknown or malformed. */
export function parseAppearance(text: string | null): Appearance {
  try {
    const raw = text ? JSON.parse(text) as unknown : null
    if (!raw || typeof raw !== 'object') return { themeId: themeById(null).id, custom: {} }
    const { themeId, custom } = raw as { themeId?: unknown; custom?: unknown }
    const known = themes.some(theme => theme.id === themeId) ? themeId as string : themeById(null).id
    const entries = custom && typeof custom === 'object'
      ? Object.entries(custom).flatMap(([id, value]) => {
        const overrides = themes.some(theme => theme.id === id) ? sanitizeOverrides(value) : null
        return overrides ? [[id, overrides] as const] : []
      })
      : []
    return { themeId: known, custom: Object.fromEntries(entries) }
  } catch {
    return { themeId: themeById(null).id, custom: {} }
  }
}

export interface ResolvedTheme { theme: Theme; colors: ThemeColors; radius: number; candleUpEdge: string; candleDownEdge: string; customized: boolean }

export function resolveTheme(appearance: Appearance): ResolvedTheme {
  const theme = themeById(appearance.themeId)
  const overrides = appearance.custom[theme.id] ?? {}
  const colors = { ...theme.colors, ...overrides.colors }
  return {
    theme, colors,
    radius: overrides.radius ?? theme.radius,
    candleUpEdge: overrides.colors?.candleUp ?? theme.candleUpEdge,
    candleDownEdge: overrides.colors?.candleDown ?? theme.candleDownEdge,
    customized: Boolean(overrides.colors || overrides.radius !== undefined),
  }
}

/** CSS custom properties for a resolved theme; component styles only read these tokens. */
export function themeTokens({ theme, colors, radius, candleUpEdge, candleDownEdge }: ResolvedTheme): Record<string, string> {
  return {
    '--background': colors.background,
    '--foreground': colors.foreground,
    '--card': colors.card,
    '--card-foreground': colors.foreground,
    '--popover': colors.card,
    '--popover-foreground': colors.foreground,
    '--primary': colors.primary,
    '--primary-foreground': colors.primaryForeground,
    '--secondary': colors.secondary,
    '--secondary-foreground': colors.foreground,
    '--muted': colors.secondary,
    '--muted-foreground': colors.mutedForeground,
    '--accent': colors.accent,
    '--accent-foreground': colors.foreground,
    '--destructive': colors.negative,
    '--destructive-foreground': colors.background,
    '--border': colors.border,
    '--input': colors.border,
    '--ring': colors.ring,
    '--field': colors.field,
    '--sidebar': mix(colors.background, colors.card, 0.5),
    '--positive': colors.positive,
    '--negative': colors.negative,
    '--warning': colors.warning,
    '--chart-drawing': theme.drawing,
    '--chart-candle-up': colors.candleUp,
    '--chart-candle-up-edge': candleUpEdge,
    '--chart-candle-down': colors.candleDown,
    '--chart-candle-down-edge': candleDownEdge,
    '--radius': `${radius / 16}rem`,
  }
}

export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement) {
  const resolved = resolveTheme(appearance)
  for (const [name, value] of Object.entries(themeTokens(resolved))) root.style.setProperty(name, value)
  root.style.colorScheme = resolved.theme.scheme
  root.dataset.theme = resolved.theme.id
  root.dataset.scheme = resolved.theme.scheme
  return resolved
}

const readStorage = () => {
  try { return window.localStorage.getItem(storageKey) } catch { return null }
}

let current: Appearance = parseAppearance(readStorage())
const listeners = new Set<() => void>()

function commit(next: Appearance) {
  current = next
  try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Private mode keeps the choice for this page only. */ }
  applyAppearance(next)
  for (const listener of listeners) listener()
}

/** Applies the stored theme before the first render, so the page never flashes the default. */
export function initAppearance() {
  current = parseAppearance(readStorage())
  applyAppearance(current)
}

export const appearanceStore = {
  get: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  selectTheme(themeId: string) { commit({ ...current, themeId: themeById(themeId).id }) },
  setColor(key: ThemeColorKey, color: string) {
    if (!isHexColor(color)) return
    const theme = themeById(current.themeId)
    const overrides = current.custom[theme.id] ?? {}
    const colors = { ...overrides.colors }
    if (theme.colors[key] === color.toLowerCase()) delete colors[key]
    else colors[key] = color.toLowerCase()
    commit(withOverrides(current, theme.id, { ...overrides, colors: Object.keys(colors).length ? colors : undefined }))
  },
  setRadius(radius: number) {
    const theme = themeById(current.themeId)
    const clamped = Math.round(Math.min(radiusRange.max, Math.max(radiusRange.min, radius)))
    const overrides = current.custom[theme.id] ?? {}
    commit(withOverrides(current, theme.id, { ...overrides, radius: clamped === theme.radius ? undefined : clamped }))
  },
  resetTheme(themeId: string) { commit(withOverrides(current, themeId, {})) },
}

function withOverrides(appearance: Appearance, themeId: string, overrides: ThemeOverrides): Appearance {
  const custom = { ...appearance.custom }
  if (overrides.colors || overrides.radius !== undefined) custom[themeId] = overrides
  else delete custom[themeId]
  return { ...appearance, custom }
}

export function useAppearance() {
  return useSyncExternalStore(appearanceStore.subscribe, appearanceStore.get, appearanceStore.get)
}
