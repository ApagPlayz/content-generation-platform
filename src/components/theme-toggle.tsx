'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { THEME_KEY, nextTheme, type Theme } from '@/lib/ui/nav'

/**
 * Light/dark switch. The actual theme was already applied by the inline script
 * in layout.tsx before first paint; this component only reads it back (after
 * mount, so server and client markup match) and writes the owner's choice to
 * localStorage so it survives a reload.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = nextTheme(theme)
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private browsing can refuse localStorage — the toggle still works for
      // this page view, it just won't be remembered.
    }
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="btn-ghost flex items-center justify-center w-9 h-9 shrink-0"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
