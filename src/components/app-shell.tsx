'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { NAV_ITEMS, activeNavId, type NavItem } from '@/lib/ui/nav'
import { ThemeToggle } from './theme-toggle'

/**
 * The one and only navigation bar (issue #126). It lives in the root layout, so
 * every page gets the same single row — pages must not render their own header.
 */
function NavTabs({ active }: { active: NavItem['id'] }) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={active === item.id ? 'page' : undefined}
          className={`nav-tab ${active === item.id ? 'nav-tab-on' : ''}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

/** Highlights the hub screen named by `?tab=`, which only the hub route uses. */
function NavTabsForTab() {
  const tab = useSearchParams().get('tab')
  return <NavTabs active={activeNavId(usePathname(), tab)} />
}

/**
 * Reading `?tab=` suspends on statically rendered routes, so the path-only
 * version is the fallback rather than a blank space — that way the bar is in
 * the HTML of every page instead of appearing a beat late.
 */
function NavTabsByPath() {
  return <NavTabs active={activeNavId(usePathname(), null)} />
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="app-header sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
          <Link href="/" className="text-xl font-extrabold tracking-tight mr-2">
            Content Engine
          </Link>
          {/* useSearchParams needs a Suspense boundary to keep `next build` happy. */}
          <Suspense fallback={<NavTabsByPath />}>
            <NavTabsForTab />
          </Suspense>
          <div className="flex-1" />
          <ThemeToggle />
          <Link
            href="/factories/new"
            className="btn-accent flex items-center gap-2 px-4 py-2 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            New Factory
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </>
  )
}
