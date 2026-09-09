/**
 * The app's single navigation model (issue #126).
 *
 * The hub used to show seven top-level tabs (Overview, Factories, Agents,
 * Inbox, Queue, Schedule, Winners) while /factories and /settings each drew
 * their own header on top. The owner asked for ONE nav bar with FEWER
 * top-level destinations — but nothing dropped.
 *
 * So the seven tabs are regrouped into three sections plus Settings, and each
 * section keeps its old tabs as sub-links. The `?tab=` values are deliberately
 * unchanged, so every existing bookmark and in-app link still lands in exactly
 * the same place and src/app/page.tsx needs no routing changes.
 *
 * Pure data + pure functions on purpose: no React, no next/navigation, so the
 * "nothing became unreachable" promise is unit-testable without a browser.
 */

export type SectionId = 'home' | 'studio' | 'pipeline' | 'settings'

export interface NavLink {
  /** Matches the `?tab=` value src/app/page.tsx already switches on. */
  id: string
  label: string
  href: string
}

export interface NavSection {
  id: SectionId
  label: string
  /** Where clicking the top-level tab goes. */
  href: string
  /** Sub-links shown for the active section only. Empty = no second row. */
  links: NavLink[]
}

/** Every tab the seven-tab hub used to offer. Nothing here may be lost. */
export const LEGACY_TABS = [
  'overview',
  'factories',
  'agents',
  'inbox',
  'queue',
  'schedule',
  'winners',
] as const

const tab = (id: string, label: string): NavLink => ({
  id,
  label,
  href: id === 'overview' ? '/' : `/?tab=${id}`,
})

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/',
    links: [tab('overview', 'Overview'), tab('winners', 'Winners')],
  },
  {
    id: 'studio',
    label: 'Studio',
    href: '/?tab=factories',
    links: [tab('factories', 'Factories'), tab('agents', 'Agents')],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    href: '/?tab=inbox',
    links: [tab('inbox', 'Inbox'), tab('queue', 'Queue'), tab('schedule', 'Schedule')],
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    links: [],
  },
]

/** tab id -> the section it now lives under. */
export const SECTION_FOR_TAB: Record<string, SectionId> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.links.map((l) => [l.id, s.id])),
)

export interface ResolvedNav {
  section: SectionId
  /** The active sub-link, if the section has any. */
  tab: string | null
}

/**
 * Work out which nav entry is highlighted for the page currently on screen.
 *
 * Routes that live outside the hub (/settings, /factories, /factories/new,
 * /agents/new) map onto the section they belong to, so they show the same one
 * nav bar with the right item lit rather than their own back-link header.
 */
export function resolveNav(pathname: string, tabParam?: string | null): ResolvedNav {
  const path = (pathname || '/').split('?')[0]

  if (path === '/settings' || path.startsWith('/settings/')) {
    return { section: 'settings', tab: null }
  }
  if (path === '/factories' || path.startsWith('/factories/')) {
    return { section: 'studio', tab: 'factories' }
  }
  if (path === '/agents' || path.startsWith('/agents/')) {
    return { section: 'studio', tab: 'agents' }
  }

  const id = tabParam || 'overview'
  const section = SECTION_FOR_TAB[id]
  return section ? { section, tab: id } : { section: 'home', tab: 'overview' }
}

export function sectionById(id: SectionId): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.id === id)
}
