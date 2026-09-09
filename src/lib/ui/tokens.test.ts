import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Structural guards for the "Warm Creator" rebuild (issue #126).
 *
 * These are the two promises that are easy to break by accident as other work
 * lands: the palette is defined ONCE (so the app stays themeable), and there is
 * exactly ONE navigation bar (the specific thing the owner called out as
 * confusing in the drafts). Both are checkable without a browser.
 */
const ROOT = process.cwd()
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')
const TW = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf8')

/** The picked style's tokens, copied from [data-style="2"] in the drafts page. */
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

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `no "${selector} {" block in globals.css`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const TSX = walk(join(ROOT, 'src'))

describe('Warm Creator palette (issue #126)', () => {
  const light = block(CSS, ':root')
  const dark = block(CSS, '.dark')

  it('defines the picked light tokens', () => {
    for (const [name, value] of Object.entries(LIGHT)) {
      expect(light, `${name} missing or wrong in :root`).toContain(`${name}: ${value}`)
    }
  })

  it('defines the picked dark tokens', () => {
    for (const [name, value] of Object.entries(DARK)) {
      expect(dark, `${name} missing or wrong in .dark`).toContain(`${name}: ${value}`)
    }
  })

  it('gives dark a value for every token light has, so nothing falls back', () => {
    const names = (b: string) => (b.match(/--[a-z0-9-]+(?=:)/g) ?? []).sort()
    expect(names(dark)).toEqual(names(light))
  })

  it('is light by default — dark needs the `dark` class', () => {
    expect(CSS.indexOf(':root {')).toBeLessThan(CSS.indexOf('.dark {'))
    expect(TW).toContain("darkMode: 'class'")
  })

  it('lives in one place: no palette hex hardcoded in a component', () => {
    const palette = [...Object.values(LIGHT), ...Object.values(DARK)].filter((v) =>
      v.startsWith('#'),
    )
    for (const file of TSX) {
      const src = readFileSync(file, 'utf8').toLowerCase()
      for (const hex of palette) {
        // #ffffff is allowed: globals.css uses it to keep white text on the
        // green/red/amber action buttons in dark mode, and that is CSS, not TSX.
        expect(src, `${file} hardcodes ${hex} — use a token instead`).not.toContain(hex)
      }
    }
  })

  it('wires Tailwind to the variables rather than to hex values', () => {
    for (const hex of [...Object.values(LIGHT), ...Object.values(DARK)]) {
      if (hex.startsWith('#')) expect(TW.toLowerCase()).not.toContain(hex)
    }
    expect(TW).toContain('var(--accent)')
    expect(TW).toContain('var(--surface)')
    expect(TW).toContain('var(--radius)')
  })
})

describe('exactly one navigation bar (issue #126)', () => {
  it('only the shared app shell renders a <nav>', () => {
    const withNav = TSX.filter((f) => readFileSync(f, 'utf8').includes('<nav'))
    expect(withNav.map((f) => f.replace(ROOT + '/', ''))).toEqual([
      'src/components/app-shell.tsx',
    ])
  })

  it('the shell is mounted once, from the root layout', () => {
    const layout = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain('<AppShell />')
    // Rendered inside <Suspense> so useSearchParams does not opt the whole app
    // out of static rendering.
    expect(layout).toContain('Suspense')
  })

  it('no page draws its own back-link header any more', () => {
    for (const page of ['src/app/page.tsx', 'src/app/settings/page.tsx', 'src/app/factories/page.tsx']) {
      const src = readFileSync(join(ROOT, page), 'utf8')
      expect(src, `${page} still has a back link`).not.toContain('Back to Hub')
      expect(src, `${page} still has a back link`).not.toContain('Back to Dashboard')
    }
  })
})
