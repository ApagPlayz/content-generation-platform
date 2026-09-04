/**
 * Navigation + theme logic for the app shell (issue #126).
 *
 * Kept free of React and the DOM so it can be unit-tested in the repo's
 * node-only vitest setup — the tests here are what prove that the seven old
 * tabs all still resolve to somewhere reachable.
 */

export type Theme = 'light' | 'dark'

/** localStorage key holding the owner's chosen theme. */
export const THEME_KEY = 'ce-theme'

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

/** The three hub screens the old seven tabs were folded into. */
export type Screen = 'home' | 'studio' | 'pipeline'

export interface NavItem {
  id: Screen | 'settings'
  label: string
  href: string
}

/** The single top-level nav. Was seven tabs plus a Settings button. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'studio', label: 'Studio', href: '/?tab=studio' },
  { id: 'pipeline', label: 'Pipeline', href: '/?tab=pipeline' },
  { id: 'settings', label: 'Settings', href: '/settings' },
]

/**
 * Old tab id -> screen that now contains it. The old ids are kept as aliases so
 * bookmarks and the existing `/?tab=factories` links keep working untouched.
 */
export const TAB_SCREEN: Record<string, Screen> = {
  home: 'home',
  overview: 'home',
  winners: 'home',
  studio: 'studio',
  factories: 'studio',
  agents: 'studio',
  pipeline: 'pipeline',
  inbox: 'pipeline',
  queue: 'pipeline',
  schedule: 'pipeline',
}

/** Every tab id that existed before the consolidation. */
export const LEGACY_TABS = [
  'overview',
  'factories',
  'agents',
  'inbox',
  'queue',
  'schedule',
  'winners',
] as const

export function resolveScreen(tab?: string | null): Screen {
  return (tab && TAB_SCREEN[tab]) || 'home'
}

/** Which nav item to highlight, given the current route. */
export function activeNavId(pathname: string, tab?: string | null): NavItem['id'] {
  if (pathname.startsWith('/settings')) return 'settings'
  // /factories, /factories/new and /agents/new are all reached from Studio.
  if (pathname.startsWith('/factories') || pathname.startsWith('/agents')) return 'studio'
  return resolveScreen(tab)
}
