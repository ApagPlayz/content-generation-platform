'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { DEFAULT_THEME, THEME_STORAGE_KEY, normalizeTheme, type Theme } from '@/lib/ui/theme'

/**
 * Light/dark switch (issue #126). The stored choice is applied before paint by
 * THEME_BOOT_SCRIPT in the layout; this button only flips it and writes it back.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)

  // Read what the boot script already decided, so the icon matches the page.
  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function toggle() {
    const next = normalizeTheme(theme === 'dark' ? 'light' : 'dark')
    document.documentElement.classList.toggle('dark', next === 'dark')
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Private browsing with storage blocked — the toggle still works for this
      // page view, it just won't be remembered.
    }
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-9 h-9 rounded-lg border border-line text-muted hover:text-ink hover:bg-surface-2"
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
