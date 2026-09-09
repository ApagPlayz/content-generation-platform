'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { NAV_SECTIONS, resolveNav, sectionById } from '@/lib/ui/nav'
import { ThemeToggle } from '@/components/theme-toggle'

/**
 * The app's one and only navigation bar (issue #126).
 *
 * Rendered once from src/app/layout.tsx so every route gets it — which is what
 * lets the hub, Settings and Factories drop the three separate headers they
 * each used to draw. Four top-level destinations instead of seven tabs; the
 * old tabs live on as sub-links under the active section, so nothing that was
 * reachable before is unreachable now.
 *
 * Split in two on purpose: `useSearchParams` opts a route out of static
 * rendering unless it sits inside a <Suspense> boundary, so the bar itself is a
 * plain component that takes the tab as a prop. The layout can then render it
 * as the Suspense fallback too, and the nav is present in the very first paint
 * rather than popping in after hydration.
 */
export function NavBar({ tabParam }: { tabParam?: string | null }) {
  const pathname = usePathname() || '/'
  const { section, tab } = resolveNav(pathname, tabParam)
  const subLinks = sectionById(section)?.links ?? []

  return (
    <header className="bg-surface border-b border-line sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-ink">
          Content Engine
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {NAV_SECTIONS.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap ${
                section === s.id
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:text-ink hover:bg-surface-2'
              }`}
            >
              {s.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <ThemeToggle />
        <Link
          href="/factories/new"
          className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-fg text-sm font-semibold hover:bg-accent-hover"
        >
          <Plus className="w-4 h-4" />
          New Factory
        </Link>
      </div>

      {subLinks.length > 0 && (
        <div className="max-w-6xl mx-auto px-6 pb-3 flex items-center gap-2 overflow-x-auto">
          {subLinks.map((l) => (
            <Link
              key={l.id}
              href={l.href}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
                tab === l.id
                  ? 'border-accent text-accent bg-accent-soft'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  )
}

export function AppShell() {
  const searchParams = useSearchParams()
  return <NavBar tabParam={searchParams?.get('tab')} />
}
