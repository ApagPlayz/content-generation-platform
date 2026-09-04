import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Guards the "Warm Creator" rebuild picked in issue #126: the palette must be
 * defined once as CSS variables (never hardcoded at call sites), light must be
 * the default with dark behind a persisted toggle, and there must be exactly
 * one navigation bar in the whole app.
 */
const root = process.cwd()
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')
const layout = readFileSync(join(root, 'src/app/layout.tsx'), 'utf8')
const tailwind = readFileSync(join(root, 'tailwind.config.ts'), 'utf8')

const LIGHT = {
  '--bg': '#faf9f7',
  '--surface': '#ffffff',
  '--surface-2': '#f5f3ef',
  '--border': '#eae7e1',
  '--text': '#1c1917',
  '--muted': '#78716c',
  '--accent': '#6d28d9',
  '--accent-fg': '#ffffff',
  '--accent-soft': '#f3f0ff',
  '--radius': '18px',
}

const DARK = {
  '--bg': '#191614',
  '--surface': '#241f1c',
  '--surface-2': '#2c2622',
  '--border': '#37302b',
  '--text': '#f5f3ef',
  '--muted': '#a8a29e',
  '--accent': '#a78bfa',
  '--accent-fg': '#1c1917',
  '--accent-soft': '#2a2340',
}

/** The declarations inside a single top-level CSS rule, e.g. `:root` or `.dark`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} block missing from globals.css`).toBeGreaterThan(-1)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

describe('Warm Creator palette (issue #126)', () => {
  it('defines every light token once, in :root', () => {
    const light = block(':root')
    for (const [name, value] of Object.entries(LIGHT)) {
      expect(light, `${name} in :root`).toContain(`${name}: ${value}`)
    }
  })

  it('defines the dark overrides in .dark', () => {
    const dark = block('.dark')
    for (const [name, value] of Object.entries(DARK)) {
      expect(dark, `${name} in .dark`).toContain(`${name}: ${value}`)
    }
  })

  it('keeps light as the default and never follows the OS setting', () => {
    expect(block(':root')).toContain('color-scheme: light')
    expect(block('.dark')).toContain('color-scheme: dark')
    expect(tailwind).toContain("darkMode: 'class'")
    expect(css).not.toContain('prefers-color-scheme')
  })

  it('re-points Tailwind’s neutral scales at the variables, not at hexes', () => {
    // This is what makes the existing bg-gray-50 / text-gray-500 / border-gray-200
    // call sites warm in light mode and correct in dark mode without a second,
    // hand-maintained copy of the mapping living in CSS.
    for (const scale of ['gray:', 'slate:', 'stone:']) {
      expect(tailwind, `${scale} should alias the shared neutral map`).toContain(scale)
    }
    expect(tailwind).toContain("lg: 'var(--radius)'")
    // No neutral literal may sneak back into the config.
    expect(tailwind).not.toMatch(/#[0-9a-f]{6}/i)
  })

  it('defines every variable the Tailwind config points at, in both modes', () => {
    const used = [...new Set([...tailwind.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]))]
    expect(used.length).toBeGreaterThan(0)
    // --radius is a shape, not a colour: it stays the same in dark mode.
    const shapeOnly = new Set(['--radius'])
    const light = block(':root')
    const dark = block('.dark')
    for (const name of used) {
      expect(light, `${name} missing from :root`).toContain(`${name}:`)
      if (!shapeOnly.has(name)) {
        expect(dark, `${name} has no dark value`).toContain(`${name}:`)
      }
    }
  })

  it('is never hardcoded in a component — the palette has one home', () => {
    const values = [...new Set([...Object.values(LIGHT), ...Object.values(DARK)])]
      .filter((v) => v.startsWith('#'))
    const offenders: string[] = []
    for (const file of tsxFiles(join(root, 'src'))) {
      const body = readFileSync(file, 'utf8').toLowerCase()
      for (const value of values) {
        if (body.includes(value)) offenders.push(`${file} -> ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('theme toggle wiring', () => {
  it('applies the saved theme before the first paint, with no flash', () => {
    expect(layout).toContain('APPLY_SAVED_THEME')
    expect(layout).toContain("classList.add('dark')")
    expect(layout).toContain('localStorage.getItem')
    // A deferred script would paint the light palette first.
    expect(layout).not.toContain('next/script')
    expect(layout).toContain('suppressHydrationWarning')
  })

  it('picks the toggle icon in CSS, so it cannot flicker after hydration', () => {
    const toggle = readFileSync(join(root, 'src/components/theme-toggle.tsx'), 'utf8')
    expect(toggle).toContain('dark:hidden')
    expect(toggle).toContain('hidden dark:block')
    // React state would render the light icon on the server and swap on mount.
    expect(toggle).not.toContain('useState')
    expect(toggle).toContain('localStorage.setItem')
  })
})

describe('single navigation bar', () => {
  const files = tsxFiles(join(root, 'src'))

  it('renders exactly one <nav>, and it lives in the shared shell', () => {
    const withNav = files.filter((f) => readFileSync(f, 'utf8').includes('<nav'))
    expect(withNav.map((f) => f.replace(`${root}/`, ''))).toEqual([
      'src/components/app-shell.tsx',
    ])
  })

  it('leaves no page rendering its own header bar', () => {
    const withHeader = files
      .filter((f) => f.endsWith('page.tsx'))
      .filter((f) => readFileSync(f, 'utf8').includes('<header'))
    expect(withHeader).toEqual([])
  })

  it('mounts the shell once, from the root layout', () => {
    expect(layout).toContain('<AppShell>')
    const shellUsers = files.filter(
      (f) => !f.endsWith('layout.tsx') && readFileSync(f, 'utf8').includes('<AppShell'),
    )
    expect(shellUsers).toEqual([])
  })
})
