import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { hookCaptionFilter } from './assemble'
import { drawtextValue, escapeDrawtext, sanitizeOverlayText } from './ffmpegText'

// The on-screen hook is written by Claude at run time, so it routinely contains
// punctuation nobody escaped for: commas, apostrophes, percent signs, brackets,
// emoji. Every one of those has to reach the screen intact. The failure this
// suite guards is NOT a crash — a `%` used to make ffmpeg draw nothing at all and
// still exit 0, so the video shipped with a blank hook and no error anywhere.

// Hooks in the shape the script stage actually produces, plus deliberate abuse.
const HOOKS = [
  '42 points, 0 misses',
  'Down 3, ice in his veins',
  'Shot 60% from three',
  '100% impossible',
  "It's over; he's done",
  'The moment: unreal',
  'LeBron [37 PTS] goes off',
  '%{pts} expression',
  'a\\b and c:d, e[f]g@h;i%j',
  "50% of shots ,,, ::: ''' [[[ ]]] ;;; @@@ \\\\\\ %%% %{pts}",
  'Unreal — "smart quotes" and it’s fine',
  'Buzzer beater 🔥 100%, unreal',
]

// ---------------------------------------------------------------------------
// A miniature of ffmpeg's own tokenizer: walk the string, treat `\x` as a
// literal x, and split only on UNESCAPED separators. Running it twice (once for
// the filtergraph's commas, once for the option list's colons) reproduces the
// two passes ffmpeg performs, so a round-trip proves the escaping is lossless
// without needing ffmpeg installed.
// ---------------------------------------------------------------------------
function unescapeSplit(s: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      cur += s[++i]
      continue
    }
    if (s[i] === sep) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += s[i]
  }
  out.push(cur)
  return out
}

/** Pull the text ffmpeg would ultimately hand to drawtext back out of a -vf string. */
function parseHookText(vf: string): { filterCount: number; text: string } {
  const filters = unescapeSplit(vf, ',') // pass 1: filtergraph
  const opts = unescapeSplit(filters[filters.length - 1], ':') // pass 2: option list
  const textOpt = opts.find((o) => o.startsWith('text='))
  return { filterCount: filters.length, text: textOpt ? textOpt.slice('text='.length) : '' }
}

describe('escapeDrawtext', () => {
  it('double-escapes each character that is special to either parser pass', () => {
    expect(escapeDrawtext('a,b')).toBe('a\\,b')
    expect(escapeDrawtext('12:30')).toBe('12\\\\:30')
    expect(escapeDrawtext("it's")).toBe("it\\\\\\'s")
    expect(escapeDrawtext('[x];y@z')).toBe('\\[x\\]\\;y\\@z')
  })

  it('leaves % alone — that layer is disabled with expansion=none, not escaped', () => {
    // If someone "fixes" this by escaping %, drawtext renders a literal backslash.
    expect(escapeDrawtext('100%')).toBe('100%')
  })
})

describe('sanitizeOverlayText', () => {
  it('flattens newlines and tabs to single spaces and trims', () => {
    expect(sanitizeOverlayText('  Down 3,\n\tice in his veins  ')).toBe('Down 3, ice in his veins')
  })

  it('returns empty string for nothing-to-draw input', () => {
    expect(sanitizeOverlayText('')).toBe('')
    expect(sanitizeOverlayText('   \n ')).toBe('')
    expect(drawtextValue('')).toBe('')
  })

  it('caps length by code point so an emoji is never cut in half', () => {
    const out = sanitizeOverlayText('🔥'.repeat(60), 90)
    expect(Array.from(out)).toHaveLength(60)
    // A split surrogate pair would not survive this round-trip.
    expect(Array.from(out).join('')).toBe(out)
  })

  it('truncates before escaping, so no dangling backslash can be left behind', () => {
    const out = drawtextValue('x'.repeat(89) + ':', 90)
    // A trailing odd run of backslashes would escape the next option separator.
    const trailing = /\\*$/.exec(out)![0].length
    expect(trailing % 2).toBe(0)
  })
})

describe('hookCaptionFilter', () => {
  it('returns null when there is no hook to draw', () => {
    expect(hookCaptionFilter('')).toBeNull()
    expect(hookCaptionFilter('   ')).toBeNull()
  })

  it('always disables %-expansion and never re-quotes the text', () => {
    const f = hookCaptionFilter('Shot 60% from three')!
    expect(f).toContain('expansion=none')
    expect(f).not.toContain("text='")
  })

  it.each(HOOKS)('survives the real filter chain intact: %j', (hook) => {
    // The exact chain runAssemble builds.
    const vf = ['crop=ih*9/16:ih', 'scale=1080:1920', hookCaptionFilter(hook)!].join(',')
    const { filterCount, text } = parseHookText(vf)
    // The bug the issue reported: a comma splitting the chain into extra filters.
    expect(filterCount).toBe(3)
    // And the stronger property: ffmpeg receives the hook byte-for-byte.
    expect(text).toBe(sanitizeOverlayText(hook))
  })
})

// ---------------------------------------------------------------------------
// Ground truth. `textfile=` needs no escaping at all, so rendering the same hook
// both ways and comparing pixels proves the inline escaping is lossless against
// the real binary rather than against our model of it. Skipped where ffmpeg (or
// a freetype-enabled build) is absent — CI installs neither.
// ---------------------------------------------------------------------------
const HAS_DRAWTEXT = (() => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).includes('drawtext')
  } catch {
    return false
  }
})()

describe.skipIf(!HAS_DRAWTEXT)('against real ffmpeg', () => {
  const dir = HAS_DRAWTEXT ? mkdtempSync(path.join(tmpdir(), 'drawtext-')) : ''

  const frameHash = (filter: string, tag: string): string => {
    const png = path.join(dir, `${tag}.png`)
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
       '-i', 'color=c=blue:s=900x360:d=1', '-vf', filter,
       '-update', '1', '-frames:v', '1', png],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    return createHash('md5').update(readFileSync(png)).digest('hex')
  }

  it.each(HOOKS)('renders identically to the unescaped ground truth: %j', (hook) => {
    const clean = sanitizeOverlayText(hook)

    const txt = path.join(dir, `${createHash('md5').update(hook).digest('hex')}.txt`)
    writeFileSync(txt, clean)
    const expected = frameHash(
      `drawtext=expansion=none:textfile=${txt}:fontcolor=white:fontsize=24:x=10:y=100`,
      'truth'
    )

    const actual = frameHash(
      `drawtext=expansion=none:text=${drawtextValue(hook)}:fontcolor=white:fontsize=24:x=10:y=100`,
      'inline'
    )

    expect(actual).toBe(expected)
  }, 30_000)
})
