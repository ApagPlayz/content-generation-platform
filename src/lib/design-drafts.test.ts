import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Guard the redesign mockup shipped for issue #49. It is a throwaway static
 * artifact (public/design-drafts.html) the owner uses to PICK a visual style
 * before the real rebuild. These checks stop it from silently rotting into an
 * empty page or losing one of the promised options, and encode the acceptance
 * checklist for the "send me drafts to pick from" request in code.
 */
const FILE = join(process.cwd(), 'public', 'design-drafts.html')

describe('design-drafts mockup (issue #49)', () => {
  const html = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

  it('exists and is non-trivial', () => {
    expect(existsSync(FILE)).toBe(true)
    expect(html.length).toBeGreaterThan(2000)
  })

  it('offers three distinct visual styles to choose from', () => {
    expect(html).toContain('Clean Studio')
    expect(html).toContain('Warm Creator')
    expect(html).toContain('Bold Focus')
    for (const n of ['1', '2', '3']) {
      expect(html).toContain(`data-set-style="${n}"`)
    }
  })

  it('condenses the 7 tabs into Home / Studio / Pipeline + Settings', () => {
    for (const screen of ['home', 'studio', 'pipeline', 'settings']) {
      expect(html).toContain(`data-screen="${screen}"`)
      expect(html).toContain(`data-set-screen="${screen}"`)
    }
  })

  it('includes the new TikTok connection card in Settings', () => {
    expect(html).toContain('TikTok')
    expect(html).toContain('Auto-post new videos')
  })

  it('is fully self-contained (no network fetch needed to open it offline)', () => {
    expect(html).not.toMatch(/src=["']https?:\/\//i)
    expect(html).not.toMatch(/href=["']https?:\/\/[^"']*\.(css|js)/i)
  })
})
