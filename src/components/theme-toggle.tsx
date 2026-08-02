'use client'

import { Moon, Sun } from 'lucide-react'
import { THEME_KEY, nextTheme } from '@/lib/ui/nav'

/**
 * Light/dark switch. The theme itself was already applied by the inline script
 * in layout.tsx before first paint; this only flips it and writes the owner's
 * choice to localStorage so it survives a reload.
 *
 * Which icon shows is decided by CSS (`dark:` variants), not React state — a
 * state-based version renders the light icon on the server and corrects itself
 * after hydration, which the owner sees as the button flickering on every load.
 */
export function ThemeToggle() {
  function toggle() {
    const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    const next = nextTheme(current)
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private browsing can refuse localStorage — the toggle still works for
      // this page view, it just won't be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark mode"
      title="Switch between light and dark mode"
      className="btn-ghost flex items-center justify-center w-9 h-9 shrink-0"
    >
      <Moon className="w-4 h-4 dark:hidden" />
      <Sun className="w-4 h-4 hidden dark:block" />
    </button>
  )
}
