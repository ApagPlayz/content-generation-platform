import { describe, expect, it } from 'vitest'
import {
  composeCaption,
  composeDescription,
  CTA_BY_FACTORY,
  ctaOverrideFromPostingDefaults,
  DEFAULT_CTA,
  resolveCta,
} from './description'

// Every published video must carry the factory's follow/CTA block so the
// channel can earn (affiliate / "follow for more") from view #1 — issue #27.

describe('resolveCta', () => {
  it('returns the built-in default for each known factory type', () => {
    expect(resolveCta('F1').text).toBe(CTA_BY_FACTORY.F1.text)
    expect(resolveCta('F9').text).toBe(CTA_BY_FACTORY.F9.text)
    expect(resolveCta('F10').text).toBe(CTA_BY_FACTORY.F10.text)
    expect(resolveCta('F11').text).toBe(CTA_BY_FACTORY.F11.text)
  })

  it('falls back to the generic DEFAULT_CTA for an unknown type', () => {
    expect(resolveCta('F99').text).toBe(DEFAULT_CTA.text)
  })

  it('lets the owner override the text and add a link', () => {
    const cta = resolveCta('F10', { text: 'Get my case files', url: 'https://ko-fi.com/x' })
    expect(cta.text).toBe('Get my case files')
    expect(cta.url).toBe('https://ko-fi.com/x')
  })

  it('treats a blank override text as "no CTA" rather than an empty line', () => {
    expect(resolveCta('F10', { text: '   ' }).text).toBe('')
  })

  it('ignores a null/undefined override (keeps the built-in default)', () => {
    expect(resolveCta('F1', null).text).toBe(CTA_BY_FACTORY.F1.text)
    expect(resolveCta('F1', undefined).text).toBe(CTA_BY_FACTORY.F1.text)
  })
})

describe('ctaOverrideFromPostingDefaults', () => {
  it('extracts a cta override from the factory postingDefaults JSON', () => {
    const json = JSON.stringify({ autonomy: 'review', cta: { text: 'Follow me', url: 'x' } })
    expect(ctaOverrideFromPostingDefaults(json)).toEqual({ text: 'Follow me', url: 'x' })
  })

  it('returns null when there is no cta key', () => {
    expect(ctaOverrideFromPostingDefaults(JSON.stringify({ autonomy: 'auto' }))).toBeNull()
  })

  it('never throws on null or malformed JSON — a bad column must not break a publish', () => {
    expect(ctaOverrideFromPostingDefaults(null)).toBeNull()
    expect(ctaOverrideFromPostingDefaults(undefined)).toBeNull()
    expect(ctaOverrideFromPostingDefaults('{not json')).toBeNull()
  })
})

describe('composeDescription', () => {
  const cta = resolveCta('F10')

  it('appends the CTA after the hashtags and keeps #Shorts last', () => {
    const out = composeDescription({ body: 'A chilling case.', hashtags: ['truecrime'], cta })
    expect(out).toContain('A chilling case.')
    expect(out).toContain('#truecrime')
    expect(out).toContain(cta.text)
    // CTA sits between the hashtags and the required #Shorts tag.
    expect(out.indexOf(cta.text)).toBeGreaterThan(out.indexOf('#truecrime'))
    expect(out.trimEnd().endsWith('#Shorts')).toBe(true)
  })

  it('still includes the CTA and #Shorts when the body is empty', () => {
    const out = composeDescription({ body: '', hashtags: [], cta })
    expect(out).toContain(cta.text)
    expect(out).toContain('#Shorts')
    // No leading blank lines from the dropped empty body.
    expect(out.startsWith('\n')).toBe(false)
  })

  it('omits the CTA block entirely when the CTA text is blank', () => {
    const out = composeDescription({ body: 'Body', hashtags: ['a'], cta: resolveCta('F10', { text: '' }) })
    expect(out).toBe('Body\n\n#a\n\n#Shorts')
  })

  it('renders the optional link under the CTA text', () => {
    const withLink = resolveCta('F10', { text: 'Support the show', url: 'https://ko-fi.com/x' })
    const out = composeDescription({ body: 'B', hashtags: [], cta: withLink })
    expect(out).toContain('Support the show\nhttps://ko-fi.com/x')
  })

  it('caps length but never truncates the CTA or #Shorts off the end', () => {
    const out = composeDescription({ body: 'x'.repeat(6000), hashtags: ['a'], cta, maxLen: 4900 })
    expect(out.length).toBeLessThanOrEqual(4900)
    expect(out).toContain(cta.text)
    expect(out.trimEnd().endsWith('#Shorts')).toBe(true)
  })
})

describe('composeCaption', () => {
  const cta = resolveCta('F9')

  it('joins title + hashtags + CTA for TikTok', () => {
    const out = composeCaption({ title: 'Wild finish', hashtags: ['sports'], cta })
    expect(out).toContain('Wild finish')
    expect(out).toContain('#sports')
    expect(out).toContain(cta.text)
  })

  it('drops an empty title without a leading space', () => {
    const out = composeCaption({ title: '', hashtags: [], cta })
    expect(out.startsWith(' ')).toBe(false)
    expect(out).toContain(cta.text)
  })

  it('caps length and preserves the CTA', () => {
    const out = composeCaption({ title: 'y'.repeat(3000), hashtags: [], cta, maxLen: 2100 })
    expect(out.length).toBeLessThanOrEqual(2100)
    expect(out).toContain(cta.text)
  })
})
