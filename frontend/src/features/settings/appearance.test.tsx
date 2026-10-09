import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { readableInk } from '@/components/chart/ink'
import { AppearanceSettings, CurrentThemeName } from './AppearanceSettings'
import { appearanceStore, initAppearance, parseAppearance, storageKey } from './appearance'
import { contrastChecks, defaultThemeId, themes } from './themes'

const root = document.documentElement
const token = (name: string) => root.style.getPropertyValue(name)

beforeEach(() => {
  window.localStorage.clear()
  initAppearance()
})

describe('Built-in themes', () => {
  it('offers dark and light themes with Graphite as the default', () => {
    expect(defaultThemeId).toBe('graphite')
    expect(themes.filter(theme => theme.scheme === 'dark').length).toBeGreaterThanOrEqual(5)
    expect(themes.filter(theme => theme.scheme === 'light').length).toBeGreaterThanOrEqual(2)
    expect(new Set(themes.map(theme => theme.id)).size).toBe(themes.length)
  })

  it.each(themes.map(theme => [theme.name, theme] as const))('%s passes every readability check', (_name, theme) => {
    expect(contrastChecks(theme.colors).filter(check => check.ratio < check.minimum)).toEqual([])
  })

  it('applies Graphite tokens when nothing is stored', () => {
    expect(root.dataset.theme).toBe('graphite')
    expect(token('--background')).toBe('#0f1114')
    expect(token('--sidebar')).toBe('#13161a')
    expect(token('--radius')).toBe('0.4375rem')
  })
})

describe('Stored appearance', () => {
  it('drops unknown themes, malformed colours and out-of-range radii', () => {
    expect(parseAppearance('not json')).toEqual({ themeId: 'graphite', custom: {} })
    expect(parseAppearance(JSON.stringify({
      themeId: 'neon',
      custom: { paper: { colors: { background: '#FAFAFA', card: 'red', bogus: '#000000' }, radius: 99 }, neon: { radius: 3 } },
    }))).toEqual({ themeId: 'graphite', custom: { paper: { colors: { background: '#fafafa' } } } })
  })

  it('keeps overrides per theme and persists them', () => {
    appearanceStore.selectTheme('paper')
    appearanceStore.setColor('primary', '#123456')
    appearanceStore.setRadius(3)
    expect(token('--primary')).toBe('#123456')
    expect(root.style.colorScheme).toBe('light')

    appearanceStore.selectTheme('midnight')
    expect(token('--primary')).toBe('#96b7ff')
    appearanceStore.selectTheme('paper')
    expect(token('--primary')).toBe('#123456')
    expect(JSON.parse(window.localStorage.getItem(storageKey)!)).toEqual({ themeId: 'paper', custom: { paper: { colors: { primary: '#123456' }, radius: 3 } } })

    appearanceStore.setColor('primary', '#1F2A37')
    appearanceStore.setRadius(7)
    expect(appearanceStore.get().custom).toEqual({})
  })
})

describe('Appearance settings', () => {
  it('switches theme, customizes a colour, warns about contrast and resets', async () => {
    render(<><AppearanceSettings /><p data-testid="name"><CurrentThemeName /></p></>)
    await userEvent.click(screen.getByRole('button', { name: /^Daylight/ }))
    expect(root.dataset.theme).toBe('daylight')
    expect(screen.getByTestId('name')).toHaveTextContent('Daylight')

    const hex = screen.getByRole('textbox', { name: 'Secondary text hex value' })
    await userEvent.clear(hex)
    await userEvent.type(hex, '#dddddd{Enter}')
    expect(token('--muted-foreground')).toBe('#dddddd')
    expect(screen.getByTestId('name')).toHaveTextContent('Daylight (customized)')
    expect(within(screen.getByRole('status', { name: 'Readability' })).getByText(/readability checks? fails?/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reset Daylight' }))
    expect(token('--muted-foreground')).toBe('#46566c')
    expect(screen.getByRole('status', { name: 'Readability' })).toHaveTextContent(/All \d+ readability checks pass/)
  })

  it('ignores an incomplete hex value', async () => {
    render(<AppearanceSettings />)
    const hex = screen.getByRole('textbox', { name: 'Panels hex value' })
    await userEvent.clear(hex)
    await userEvent.type(hex, '#12{Enter}')
    expect(token('--card')).toBe('#171a1f')
    expect(hex).toHaveValue('#171a1f')
  })
})

describe('Chart level tags', () => {
  it('pick dark ink on pastel levels and white ink on deep ones', () => {
    expect(readableInk('#a9d6b6')).toBe('#151c20')
    expect(readableInk('#17784a')).toBe('#ffffff')
    expect(readableInk('rgb(180, 42, 42)')).toBe('#ffffff')
  })
})
