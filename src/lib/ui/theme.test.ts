import vm from 'node:vm'
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THEME,
  THEME_BOOT_SCRIPT,
  THEME_STORAGE_KEY,
  normalizeTheme,
} from './theme'

/**
 * The boot script decides the theme before the first paint. It is the piece
 * that makes "dark survives a reload" true, so run the real string in a
 * sandbox with a fake document/localStorage rather than trusting it by eye.
 */
function runBootScript(stored: string | null, storageThrows = false) {
  const classes = new Set<string>()
  const sandbox = {
    localStorage: {
      getItem(key: string) {
        if (storageThrows) throw new Error('storage disabled')
        return key === THEME_STORAGE_KEY ? stored : null
      },
    },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c) } } },
  }
  vm.runInNewContext(THEME_BOOT_SCRIPT, sandbox)
  return classes
}

describe('theme persistence (issue #126)', () => {
  it('defaults to light', () => {
    expect(DEFAULT_THEME).toBe('light')
    expect(runBootScript(null).has('dark')).toBe(false)
  })

  it('restores a saved dark choice before the first paint', () => {
    expect(runBootScript('dark').has('dark')).toBe(true)
  })

  it('ignores a junk stored value instead of breaking the page', () => {
    expect(runBootScript('purple').has('dark')).toBe(false)
    expect(runBootScript('').has('dark')).toBe(false)
  })

  it('survives storage being blocked (private browsing)', () => {
    expect(() => runBootScript(null, true)).not.toThrow()
  })

  it('normalizeTheme only ever returns a real theme', () => {
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('light')).toBe('light')
    expect(normalizeTheme(undefined)).toBe('light')
    expect(normalizeTheme(42)).toBe('light')
  })
})
