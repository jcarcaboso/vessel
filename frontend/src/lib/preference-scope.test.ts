import { describe, expect, it } from 'vitest'
import { appearanceStore, initAppearance, readDeviceTheme } from '@/features/settings/appearance'
import { deviceThemeKey, legacyPreferenceKeys, preferenceKey, scopePreferences, userPreferenceKey } from './preference-scope'

const owner = 'a3c1f6e2-5b8d-4e0a-9f27-1d6c4b8e3a90'
const member = '0d4f7c2a-9b1e-4e63-8a05-2c7b9d1f3e68'
const legacyAppearance = JSON.stringify({ themeId: 'graphite', custom: {}, saved: [], draft: null })
const legacyChart = JSON.stringify({ interval: '4h', schemaVersion: 2 })

describe('per-user preferences', () => {
  it('uses the legacy keys before sign-in and the user keys after', () => {
    expect(preferenceKey('appearance')).toBe('vessel.appearance')
    scopePreferences(member, false)
    expect(preferenceKey('appearance')).toBe(`vessel:u:${member}:appearance`)
    expect(preferenceKey('chart.preferences.v1')).toBe(`vessel:u:${member}:chart.preferences.v1`)
  })

  it('lets the migrated owner adopt each legacy key, then deletes it', () => {
    localStorage.setItem(legacyPreferenceKeys.appearance, legacyAppearance)
    localStorage.setItem(legacyPreferenceKeys['chart.preferences.v1'], legacyChart)
    scopePreferences(owner, true)
    expect(localStorage.getItem(userPreferenceKey(owner, 'appearance'))).toBe(legacyAppearance)
    expect(localStorage.getItem(userPreferenceKey(owner, 'chart.preferences.v1'))).toBe(legacyChart)
    expect(localStorage.getItem(legacyPreferenceKeys.appearance)).toBeNull()
    expect(localStorage.getItem(legacyPreferenceKeys['chart.preferences.v1'])).toBeNull()
  })

  it('never overwrites a user key that already exists', () => {
    const mine = JSON.stringify({ interval: '1d', schemaVersion: 2 })
    localStorage.setItem(userPreferenceKey(owner, 'chart.preferences.v1'), mine)
    localStorage.setItem(legacyPreferenceKeys['chart.preferences.v1'], legacyChart)
    scopePreferences(owner, true)
    expect(localStorage.getItem(userPreferenceKey(owner, 'chart.preferences.v1'))).toBe(mine)
    expect(localStorage.getItem(legacyPreferenceKeys['chart.preferences.v1'])).toBeNull()
  })

  it('leaves the legacy keys alone for every other user', () => {
    localStorage.setItem(legacyPreferenceKeys.appearance, legacyAppearance)
    scopePreferences(member, false)
    expect(localStorage.getItem(userPreferenceKey(member, 'appearance'))).toBeNull()
    expect(localStorage.getItem(legacyPreferenceKeys.appearance)).toBe(legacyAppearance)
  })

  it('switches the in-memory appearance store and records the built-in theme for this device', () => {
    localStorage.setItem(userPreferenceKey(member, 'appearance'), JSON.stringify({ themeId: 'paper', custom: {}, saved: [], draft: null }))
    appearanceStore.selectTheme('graphite')
    // Before sign-in, choices go to the legacy key and never to the device theme.
    expect(JSON.parse(localStorage.getItem('vessel.appearance')!).themeId).toBe('graphite')
    expect(localStorage.getItem(deviceThemeKey)).toBeNull()
    scopePreferences(member, false)
    expect(appearanceStore.get().themeId).toBe('paper')
    expect(document.documentElement.dataset.theme).toBe('paper')
    expect(localStorage.getItem(deviceThemeKey)).toBe('paper')
    appearanceStore.selectTheme('graphite')
    expect(JSON.parse(localStorage.getItem(userPreferenceKey(member, 'appearance'))!).themeId).toBe('graphite')
    expect(localStorage.getItem(deviceThemeKey)).toBe('graphite')
  })

  it('applies the device theme before sign-in, built-in IDs only', () => {
    localStorage.setItem('vessel.appearance', JSON.stringify({ themeId: 'graphite', custom: {}, saved: [], draft: null }))
    localStorage.setItem(deviceThemeKey, 'paper')
    initAppearance()
    expect(document.documentElement.dataset.theme).toBe('paper')
    localStorage.setItem(deviceThemeKey, 'custom-evil')
    expect(readDeviceTheme()).toBeNull()
    initAppearance()
    expect(document.documentElement.dataset.theme).toBe('graphite')
  })
})
