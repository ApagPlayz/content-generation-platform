import { describe, it, expect } from 'vitest'
import {
  NAV_ITEMS,
  LEGACY_TABS,
  THEME_KEY,
  activeNavId,
  nextTheme,
  resolveScreen,
} from './nav'

/**
 * The acceptance checklist for issue #126, in code: fewer top-level tabs, and
 * nothing that used to be reachable became unreachable.
 */
describe('nav consolidation (issue #126)', () => {
  it('has fewer top-level destinations than the old seven tabs', () => {
    expect(NAV_ITEMS.length).toBeLessThan(7)
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      'Home',
      'Studio',
      'Pipeline',
      'Settings',
    ])
  })

  it('gives every nav item a unique id and href', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.id)).size).toBe(NAV_ITEMS.length)
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length)
  })

  it('still resolves all seven old tabs to a screen — no feature is lost', () => {
    const screens = LEGACY_TABS.map((tab) => resolveScreen(tab))
    expect(screens).toEqual([
      'home', // overview
      'studio', // factories
      'studio', // agents
      'pipeline', // inbox
      'pipeline', // queue
      'pipeline', // schedule
      'home', // winners
    ])
    // Each of the three screens actually carries some of the old tabs.
    expect(new Set(screens)).toEqual(new Set(['home', 'studio', 'pipeline']))
  })

  it('falls back to Home for a missing or unknown tab', () => {
    expect(resolveScreen(undefined)).toBe('home')
    expect(resolveScreen(null)).toBe('home')
    expect(resolveScreen('')).toBe('home')
    expect(resolveScreen('not-a-tab')).toBe('home')
  })

  it('highlights the right nav item for each route', () => {
    expect(activeNavId('/', undefined)).toBe('home')
    expect(activeNavId('/', 'winners')).toBe('home')
    expect(activeNavId('/', 'factories')).toBe('studio')
    expect(activeNavId('/', 'queue')).toBe('pipeline')
    expect(activeNavId('/settings')).toBe('settings')
    // The create forms belong to Studio, so the bar doesn't go blank on them.
    expect(activeNavId('/factories/new')).toBe('studio')
    expect(activeNavId('/agents/new')).toBe('studio')
  })
})

describe('theme toggle', () => {
  it('flips between light and dark', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })

  it('remembers the choice under a stable storage key', () => {
    expect(THEME_KEY).toBe('ce-theme')
  })
})
