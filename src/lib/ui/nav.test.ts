import { describe, it, expect } from 'vitest'
import {
  LEGACY_TABS,
  NAV_SECTIONS,
  SECTION_FOR_TAB,
  resolveNav,
  sectionById,
} from './nav'

/**
 * The nav consolidation for issue #126. The owner's hard requirement was
 * "fewer top-level tabs, but keep every existing feature reachable", so the
 * important test here is the one that walks the OLD seven-tab list and proves
 * each one still has a home.
 */
describe('nav consolidation (issue #126)', () => {
  it('has fewer top-level destinations than the seven tabs it replaces', () => {
    expect(NAV_SECTIONS.length).toBeLessThan(LEGACY_TABS.length)
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual([
      'home',
      'studio',
      'pipeline',
      'settings',
    ])
  })

  it('keeps every one of the old tabs reachable', () => {
    for (const tab of LEGACY_TABS) {
      expect(SECTION_FOR_TAB[tab], `tab "${tab}" lost its home`).toBeTruthy()
    }
  })

  it('files each old tab under exactly one section', () => {
    const seen = NAV_SECTIONS.flatMap((s) => s.links.map((l) => l.id))
    expect(seen.length).toBe(new Set(seen).size)
    expect(new Set(seen)).toEqual(new Set(LEGACY_TABS))
  })

  it('keeps the old ?tab= URLs working, so bookmarks do not break', () => {
    const byId = Object.fromEntries(
      NAV_SECTIONS.flatMap((s) => s.links.map((l) => [l.id, l.href])),
    )
    expect(byId.overview).toBe('/')
    expect(byId.winners).toBe('/?tab=winners')
    expect(byId.queue).toBe('/?tab=queue')
  })

  it('every section links somewhere and has a label', () => {
    for (const s of NAV_SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.href.startsWith('/')).toBe(true)
      expect(sectionById(s.id)).toBe(s)
    }
  })
})

describe('resolveNav — which nav item lights up', () => {
  it('defaults to Home / Overview', () => {
    expect(resolveNav('/')).toEqual({ section: 'home', tab: 'overview' })
    expect(resolveNav('/', null)).toEqual({ section: 'home', tab: 'overview' })
  })

  it.each([
    ['winners', 'home'],
    ['factories', 'studio'],
    ['agents', 'studio'],
    ['inbox', 'pipeline'],
    ['queue', 'pipeline'],
    ['schedule', 'pipeline'],
  ] as const)('?tab=%s lights up %s', (tab, section) => {
    expect(resolveNav('/', tab).section).toBe(section)
    expect(resolveNav('/', tab).tab).toBe(tab)
  })

  it('maps the standalone routes onto their section instead of a second nav', () => {
    expect(resolveNav('/settings')).toEqual({ section: 'settings', tab: null })
    expect(resolveNav('/factories')).toEqual({ section: 'studio', tab: 'factories' })
    expect(resolveNav('/factories/new')).toEqual({ section: 'studio', tab: 'factories' })
    expect(resolveNav('/agents/new')).toEqual({ section: 'studio', tab: 'agents' })
  })

  it('falls back to Home rather than showing nothing selected', () => {
    expect(resolveNav('/', 'not-a-real-tab').section).toBe('home')
    expect(resolveNav('/some/unknown/page').section).toBe('home')
  })
})
