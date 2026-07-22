// F11 script stage. Turns a TopicBrief into a beat-structured mini-doc script
// using history/business archetypes: HOOK → CONTEXT → THE RISE → THE TURNING
// POINT → THE FALLOUT (climax) → LEGACY / LESSON. The output is an F10Script
// (same shape) so the shared footage, compliance, captions, and assemble
// stages consume it unchanged.
//
// Uses Claude when factory.config.useAiScript is on AND ANTHROPIC_API_KEY (or
// CLAUDE_API_KEY) is set; otherwise a deterministic template that narrates the
// (neutrally-worded) Wikipedia facts as beats, hedges anything contested, and
// attributes every load-bearing claim to the public record — compliant-by-
// construction so the offline path still clears the gate. Pacing numbers
// (durations, cut cadence, music curve) are fixed in code; the model only
// fills language and visual cues.
//
// Visual cues stay inside the CUE_QUERY_MAP-safe vocabulary defined in
// src/lib/truecrime/footage.ts (newspaper/document/map/clock/rain/city…) so
// the shared footage ladder maps every beat to a safe, generic b-roll query.

import { prisma } from '../prisma'
import { resolveModel, claudeCallCost } from '../settings'
import { scoreHookCandidate } from '../tools/hookScore'
import type { ScriptStructure } from '../compliance'
import {
  loadRecentStyleProfiles,
  pickDivergentStyle,
  type StyleProfile,
} from '../truecrime/styleVariation'
import type {
  HookCandidate,
  HookType,
  ScriptBeat,
} from '../truecrime/types'
import type { F11FactoryConfig, F11Script, TopicBrief } from './types'

const HOOK_TYPES: HookType[] = [
  'open_loop',
  'statistic',
  'question',
  'in_media_res',
  'contradiction',
  'overlooked_detail',
  'timeline',
  'unresolved_mystery',
]

/** History/business default visual looks, rotated per video. Overridden by
 *  factory.config.styleRotation. All non-crime framings. */
const HISTORY_STYLE_POOL = [
  'archival-photo-doc',
  'newsprint-collage',
  'map-timeline',
  'ledger-and-charts',
  'boardroom-noir',
  'vintage-ad-collage',
  'stock-ticker-grain',
]

/** Neutral analytical framings for business/history stories — none implies an
 *  accusation, so injecting one never trips the defamation lint. Overridden by
 *  factory.config.editorialAngles. */
const HISTORY_EDITORIAL_ANGLES = [
  'business-postmortem',
  'timeline-reconstruction',
  'decision-point-analysis',
  'myth-vs-record',
  'rise-and-fall-recap',
]

/** Fixed pacing per beat. Cut cadence tightens and music swells toward the
 *  climax; THE FALLOUT carries the dramatic payoff (the collapse / consequence)
 *  and lands at ~75–85% of runtime. Two templates by length. */
interface BeatSpec {
  name: string
  targetSeconds: number
  cutIntervalSec: number
  musicIntensity: number
  isClimax?: boolean
}

const BEATS_60: BeatSpec[] = [
  { name: 'Hook', targetSeconds: 4, cutIntervalSec: 3.5, musicIntensity: 0.3 },
  { name: 'Context', targetSeconds: 9, cutIntervalSec: 3.5, musicIntensity: 0.35 },
  { name: 'The Rise', targetSeconds: 13, cutIntervalSec: 2.5, musicIntensity: 0.5 },
  { name: 'The Turning Point', targetSeconds: 12, cutIntervalSec: 2.0, musicIntensity: 0.7 },
  { name: 'The Fallout', targetSeconds: 13, cutIntervalSec: 1.2, musicIntensity: 0.95, isClimax: true },
  { name: 'Legacy / Lesson', targetSeconds: 9, cutIntervalSec: 2.5, musicIntensity: 0.5 },
]

const BEATS_90: BeatSpec[] = [
  { name: 'Hook', targetSeconds: 5, cutIntervalSec: 3.5, musicIntensity: 0.3 },
  { name: 'Context', targetSeconds: 12, cutIntervalSec: 3.5, musicIntensity: 0.35 },
  { name: 'The Rise', targetSeconds: 15, cutIntervalSec: 2.6, musicIntensity: 0.45 },
  { name: 'The Rise 2', targetSeconds: 15, cutIntervalSec: 2.2, musicIntensity: 0.6 },
  { name: 'The Turning Point', targetSeconds: 15, cutIntervalSec: 1.8, musicIntensity: 0.75 },
  { name: 'The Fallout', targetSeconds: 16, cutIntervalSec: 1.2, musicIntensity: 0.95, isClimax: true },
  { name: 'Legacy / Lesson', targetSeconds: 12, cutIntervalSec: 2.5, musicIntensity: 0.5 },
]

const WORDS_PER_SEC = 2.7

function specsFor(targetDurationSec: number): BeatSpec[] {
  return targetDurationSec >= 80 ? BEATS_90 : BEATS_60
}

/** Maps an editorial-angle SLUG to natural, grammatical copy: a full closing
 *  sentence and a noun-phrase "framing" for the hook loop, description, and AI
 *  prompt. This replaces raw-slug interpolation, which produced broken prose
 *  like "This courtroom sticks to what the public record documents." Unknown
 *  angles fall back to a safe generic line. */
const ANGLE_COPY: Record<string, { close: string; framing: string }> = {
  'turning-point': {
    close: 'The turning point comes into focus once the documented record is lined up in order.',
    framing: 'turning-point breakdown',
  },
  'human-story': {
    close: 'Underneath the events, the human story stays anchored to what the record documents.',
    framing: 'human-story angle',
  },
  'myth-vs-record': {
    close: 'Where the popular myth and the record diverge, this stays with what is documented.',
    framing: 'myth-versus-record check',
  },
  legacy: {
    close: 'Its legacy still rests on what the public record documents.',
    framing: 'legacy retrospective',
  },
  'business-postmortem': {
    close: 'Read as a business postmortem, it stays with what the public record documents.',
    framing: 'business postmortem',
  },
  'timeline-reconstruction': {
    close: 'Reconstructed step by step, the timeline stays with what the public record documents.',
    framing: 'timeline reconstruction',
  },
  'decision-point-analysis': {
    close: 'At each decision point, the account stays with what the public record documents.',
    framing: 'decision-point analysis',
  },
  'rise-and-fall-recap': {
    close: 'From the rise to the fall, the recap stays with what the public record documents.',
    framing: 'rise-and-fall recap',
  },
}

const DEFAULT_ANGLE_COPY = {
  close: 'Throughout, the account stays with what the public record documents.',
  framing: 'closer look',
}

/** Grammatical copy for an editorial angle. Never interpolates a raw slug. */
export function angleCopyFor(angleSlug: string): { close: string; framing: string } {
  return ANGLE_COPY[(angleSlug || '').toLowerCase()] ?? DEFAULT_ANGLE_COPY
}

/** "a"/"an" for a phrase, by leading vowel. */
function withArticle(phrase: string): string {
  return /^[aeiou]/i.test(phrase.trim()) ? `an ${phrase}` : `a ${phrase}`
}

function capitalizeFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** Structural signature reflects the real beats so the inauthentic-content
 *  variation check sees genuine per-topic variety. */
function structureFor(
  brief: TopicBrief,
  specs: BeatSpec[],
  hookType: string,
  style: StyleProfile
): ScriptStructure {
  return {
    hookPattern: brief.angle ? `operator-angle:${hookType}` : hookType,
    sections: specs.map((s) => s.name.toLowerCase()),
    visualStyle: style.visualStyle,
    editorialAngle: style.editorialAngle,
  }
}

export async function generateHistoryScript(
  videoId: string,
  playbook: string,
  brief: TopicBrief,
  config: F11FactoryConfig
): Promise<F11Script> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY
  const targetDurationSec = config.targetDurationSec ?? 75
  const specs = specsFor(targetDurationSec)
  const citations = [brief.wikipediaUrl]

  // Force this video's look + editorial framing to DIVERGE from recent runs —
  // the active defence against the "inauthentic content" policy. Best-effort +
  // keyless: an empty corpus falls back to a deterministic per-topic pick.
  const window = config.styleDivergenceWindow ?? 5
  const style = pickDivergentStyle(await loadRecentStyleProfiles(window), {
    caseName: brief.caseName,
    pool: config.styleRotation?.length ? config.styleRotation : HISTORY_STYLE_POOL,
    angles: config.editorialAngles?.length ? config.editorialAngles : HISTORY_EDITORIAL_ANGLES,
    window,
  })
  const editorialLayer = config.enableEditorialLayer !== false

  if (!config.useAiScript || !apiKey) {
    return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
  }

  const m = await resolveModel(config.scriptModel ?? 'sonnet5')
  const wordBudget = Math.round(targetDurationSec * WORDS_PER_SEC)

  try {
    const subjectLines = brief.subjects
      .map((s) => `- ${s.name}: role=${s.role}, living=${s.living}, minor=${s.isMinor}`)
      .join('\n')

    const beatGuide = specs
      .map(
        (s, i) =>
          `${i + 1}. ${s.name} (~${s.targetSeconds}s, ~${Math.round(s.targetSeconds * WORDS_PER_SEC)} words)` +
          (s.isClimax ? ' ← CLIMAX / the collapse, consequence, or key documented reveal' : '')
      )
      .join('\n')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: m.model,
        max_tokens: 2200,
        system: [
          {
            type: 'text',
            text:
              `${playbook}\n\n` +
              'You write a documentary-tone, faceless history/business-story SHORT as a ' +
              'structured mini-doc arc (rise → turning point → fallout → lesson). Internally ' +
              'brainstorm several hook angles (open_loop, statistic, question, in_media_res, ' +
              'contradiction, overlooked_detail, timeline, unresolved_mystery) and output only ' +
              'the single strongest hook.\n\n' +
              'STORYTELLING RULES:\n' +
              `- Total spoken narration ≈ ${wordBudget} words across the beats below.\n` +
              '- Every beat after the Hook MUST connect to the previous beat with "but" or ' +
              '"therefore" (causal), never "and then" (sequential). Set linkWord accordingly.\n' +
              '- Build rising momentum; THE FALLOUT beat carries the collapse/consequence — the ' +
              'key documented reveal. THE TURNING POINT is the mid-video re-hook.\n' +
              '- The hook fires 3 layers: verbal (10–14 words, calm, lands in 3s), onscreenText ' +
              '(≤7 words, NOT a copy of the verbal line), visualCue (a generic archival-style shot).\n\n' +
              'HARD COMPLIANCE RULES:\n' +
              '- Never assert wrongdoing (fraud, crime, deception) as fact about anyone not ' +
              'convicted; use "alleged/accused/reportedly" and ATTRIBUTE contested claims ' +
              '("according to court records", "regulators said", "contemporary reporting says"). ' +
              'Set sourceAttribution on any beat with a contested claim, and complianceFlag = ' +
              'factual | attributed | opinion-clear.\n' +
              '- Never name or depict minors. Stick to the documented public record; numbers and ' +
              'dates must come from the verified facts provided — never invent figures.\n' +
              '- visualCue must be GENERIC b-roll (newspapers, documents, maps, clocks, city ' +
              'skylines, roads, rain) — never a named person or brand asset.\n\n' +
              (editorialLayer
                ? `EDITORIAL FRAMING: frame this as ${withArticle(angleCopyFor(style.editorialAngle).framing)} — ` +
                  'original analytical commentary on the documented record, not a bare recap. The ' +
                  'framing must ADD analysis; it must never introduce a new accusation and every ' +
                  'factual claim stays attributed and hedged.\n\n'
                : '') +
              `BEAT TEMPLATE (return EXACTLY ${specs.length} beats, in this order):\n${beatGuide}\n\n` +
              'Respond with ONLY JSON: {"hook":{"type","verbal","onscreenText","visualCue",' +
              '"opensLoop","payoffRef"},"beats":[{"name","narration","linkWord","visualCue",' +
              '"captionEmphasisWord","sourceAttribution","complianceFlag"}],"title"(≤80 chars),' +
              '"description","hashtags"(5-8, no #)}. The first beat\'s narration is the hook verbal line.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              `Topic: ${brief.caseName}\nYear: ${brief.year ?? 'unknown'}\n` +
              `Angle: ${brief.angle ?? '(choose a fresh one)'}\n` +
              `Subjects:\n${subjectLines}\n\nVerified facts:\n${brief.facts.join('\n')}`,
          },
        ],
      }),
    })
    if (!res.ok) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)

    const data = await res.json()
    const { total, units } = claudeCallCost(data.usage ?? {}, m)
    await prisma.costLedger.create({
      data: { videoId, service: m.model, units, unitCost: m.inputCostPerToken, total },
    })

    const text: string = data.content?.[0]?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
    const parsed = JSON.parse(jsonMatch[0])

    const built = buildFromModel(parsed, specs)
    if (!built) return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)

    const fallback = templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
    const hookGate = scoreHookCandidate(built.hook)
    return {
      caseName: brief.caseName,
      subjects: brief.subjects,
      narration: built.narration,
      visuals: [],
      citations,
      targetDurationSec,
      structure: structureFor(brief, specs, built.hook.type, style),
      hook: built.hook,
      beats: built.beats,
      hookScore: hookGate.score,
      hookStyle: hookGate.style,
      title: parsed.title ? String(parsed.title).slice(0, 100) : fallback.title,
      description: parsed.description ? String(parsed.description) : fallback.description,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : fallback.hashtags,
    }
  } catch {
    return templateScript(brief, specs, targetDurationSec, citations, style, editorialLayer)
  }
}

/** Validate + normalize the model's JSON into a hook + beats, zipping the
 *  fixed pacing template onto each beat. Returns null if the shape is unusable
 *  (caller falls back to the template script). */
function buildFromModel(
  parsed: unknown,
  specs: BeatSpec[]
): { hook: HookCandidate; beats: ScriptBeat[]; narration: string } | null {
  const p = parsed as {
    hook?: Partial<HookCandidate>
    beats?: Array<Partial<ScriptBeat>>
  }
  const rawBeats = Array.isArray(p.beats) ? p.beats : []
  if (rawBeats.length === 0 || !p.hook?.verbal) return null

  const beats: ScriptBeat[] = specs.map((spec, i) => {
    const rb = rawBeats[i] ?? {}
    const narration = String(rb.narration ?? '').trim()
    return {
      name: spec.name,
      index: i,
      narration,
      targetSeconds: spec.targetSeconds,
      linkWord: rb.linkWord === 'but' || rb.linkWord === 'therefore' ? rb.linkWord : i === 0 ? undefined : 'therefore',
      visualCue: String(rb.visualCue ?? '').trim() || defaultVisualCue(spec.name),
      cutIntervalSec: spec.cutIntervalSec,
      musicIntensity: spec.musicIntensity,
      captionEmphasisWord: rb.captionEmphasisWord ? String(rb.captionEmphasisWord) : undefined,
      sourceAttribution: rb.sourceAttribution ? String(rb.sourceAttribution) : undefined,
      complianceFlag:
        rb.complianceFlag === 'attributed' || rb.complianceFlag === 'opinion-clear'
          ? rb.complianceFlag
          : 'factual',
    }
  })

  const hookType = (HOOK_TYPES as string[]).includes(String(p.hook.type))
    ? (p.hook.type as HookType)
    : 'open_loop'
  const hook: HookCandidate = {
    type: hookType,
    verbal: String(p.hook.verbal).trim(),
    onscreenText: String(p.hook.onscreenText ?? '').trim().split(/\s+/).slice(0, 7).join(' '),
    visualCue: String(p.hook.visualCue ?? '').trim() || defaultVisualCue('Hook'),
    opensLoop: String(p.hook.opensLoop ?? '').trim(),
    payoffRef: p.hook.payoffRef ? String(p.hook.payoffRef) : 'The Fallout',
  }

  // The spoken hook is exactly the chosen verbal line.
  beats[0].narration = hook.verbal

  // Reject if too many beats came back empty (model didn't follow the template).
  if (beats.filter((b) => b.narration.length > 0).length < Math.ceil(specs.length / 2)) return null

  const narration = beats
    .map((b) => b.narration)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { hook, beats, narration }
}

/** Generic, person-free mood cue per beat. Every cue here matches a
 *  CUE_QUERY_MAP entry in src/lib/truecrime/footage.ts (newspaper, city, map,
 *  clock, rain, document) so the shared footage ladder resolves it to a safe,
 *  non-identifying b-roll query. Never references real people or brands. */
function defaultVisualCue(beatName: string): string {
  const n = beatName.toLowerCase()
  if (n.includes('turning')) return 'clock face close up, midnight'
  if (n.startsWith('hook')) return 'vintage newspaper headline, slow push-in'
  if (n.includes('context')) return 'city skyline at dusk, establishing shot'
  if (n.includes('rise')) return 'old map close up, slow drift'
  if (n.includes('fallout')) return 'rain on a window at night'
  if (n.includes('legacy') || n.includes('lesson')) return 'old documents on a desk, warm light'
  return 'archival photograph, slow drift'
}

// ─────────────────────────── Offline / fallback template ───────────────────────────

/** Hedge line for the closing beat. Business/history stories can still involve
 *  accused (not convicted) people; hedge them exactly like F10. Otherwise, if
 *  living subjects appear, anchor the account to the public record. */
function hedge(brief: TopicBrief): string {
  const unproven = brief.subjects.filter((s) => s.role === 'accused' || s.role === 'acquitted')
  const acquitted = unproven.filter((s) => s.role === 'acquitted').map((s) => s.name)
  if (acquitted.length > 0) {
    return `${acquitted.join(' and ')} ${acquitted.length > 1 ? 'were' : 'was'} acquitted; nothing here asserts guilt.`
  }
  if (unproven.length > 0) {
    return `The allegations against ${unproven.map((s) => s.name).join(' and ')} remain unproven in court.`
  }
  const living = brief.subjects.filter((s) => s.living).map((s) => s.name)
  if (living.length > 0) {
    return `Everything here about ${living.join(' and ')} follows the documented public record.`
  }
  return ''
}

/** Deterministic beat script from the neutral Wikipedia facts. Compliant by
 *  construction: attributes claims, hedges anything contested, and points to
 *  the source — so the offline path clears the gate. */
function templateScript(
  brief: TopicBrief,
  specs: BeatSpec[],
  targetDurationSec: number,
  citations: string[],
  style: StyleProfile,
  editorialLayer: boolean
): F11Script {
  const facts = brief.facts.length ? brief.facts : [brief.summary.slice(0, 200)]
  const hedgeLine = hedge(brief)
  const hasAngle = !!brief.angle?.trim()
  const lastFact = facts[facts.length - 1]
  // A generic, hedged editorial frame — NEVER a topic-specific assertion, so it
  // can't trip the defamation lint or the corroboration rule. Off when the
  // operator disables the editorial layer.
  // Each angle maps to a full, grammatical sentence (no raw-slug interpolation —
  // that produced "This courtroom sticks to what the public record documents.").
  const copy = editorialLayer ? angleCopyFor(style.editorialAngle) : null
  const editorialClose = copy ? ` ${copy.close}` : ''

  // Varied fillers so a fact-poor topic never repeats the same line verbatim.
  const fillers = [
    'Contemporary reporting kept circling the same open questions.',
    'The numbers in the public record tell a more complicated story.',
    'On paper everything looked stable; the record shows how quickly that changed.',
  ]
  let fillerIdx = 0

  // The hook is the crafted angle when the operator supplied one (tight,
  // scroll-stopping); otherwise the first verified sentence. Content beats then
  // walk the remaining facts in order — reserving the LAST fact for the climax
  // (The Fallout) — so none repeat and the strongest fact lands at the peak.
  let cursor = hasAngle ? 0 : 1 // if no angle, facts[0] is spent on the hook
  const nextFact = (): string => {
    if (cursor < facts.length - 1) return facts[cursor++]
    return fillers[fillerIdx++ % fillers.length]
  }
  // Return the next filler that differs from `avoid` (fillers are all distinct,
  // so one always qualifies) — used to break a consecutive repeat.
  const distinctFiller = (avoid: string): string => {
    for (let k = 0; k < fillers.length; k++) {
      const f = fillers[fillerIdx++ % fillers.length]
      if (f !== avoid) return f
    }
    return fillers[0]
  }

  const beatTexts: string[] = specs.map((spec, i) => {
    const n = spec.name.toLowerCase()
    if (i === 0) return (hasAngle ? brief.angle! : facts[0]).trim()
    if (spec.isClimax)
      return `According to public records and reporting, this is where the story turned. ${lastFact}`.trim()
    if (n.includes('legacy') || n.includes('lesson'))
      return `${hedgeLine}${editorialClose} The full account is documented at the source linked below.`.trim()
    // Context / rise / turning point: next unused fact.
    return nextFact()
  })

  // Guarantee no two CONSECUTIVE beats share the exact same sentence — the old
  // bug where a fact-poor topic repeated one filler line back-to-back. Any beat
  // that matches the one before it is swapped for a fresh, distinct filler.
  for (let i = 1; i < beatTexts.length; i++) {
    if (beatTexts[i] && beatTexts[i] === beatTexts[i - 1]) {
      beatTexts[i] = distinctFiller(beatTexts[i - 1])
    }
  }

  const beats: ScriptBeat[] = specs.map((spec, i) => ({
    name: spec.name,
    index: i,
    narration: beatTexts[i],
    targetSeconds: spec.targetSeconds,
    linkWord: i === 0 ? undefined : i % 2 === 0 ? 'therefore' : 'but',
    visualCue: defaultVisualCue(spec.name),
    cutIntervalSec: spec.cutIntervalSec,
    musicIntensity: spec.musicIntensity,
    sourceAttribution: spec.isClimax ? 'public records and reporting' : undefined,
    complianceFlag: spec.isClimax ? 'attributed' : 'factual',
  }))

  const hook: HookCandidate = {
    type: 'open_loop',
    verbal: beatTexts[0],
    onscreenText: `${brief.caseName}`.split(/\s+/).slice(0, 7).join(' '),
    visualCue: defaultVisualCue('Hook'),
    opensLoop: copy
      ? `${withArticle(copy.framing)} of how it actually unfolded`
      : 'how the documented record says it actually unfolded',
    payoffRef: 'Legacy / Lesson',
  }

  const narration = beats
    .map((b) => b.narration)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  const yr = brief.year ? ` (${brief.year})` : ''
  const hookGate = scoreHookCandidate(hook)
  return {
    caseName: brief.caseName,
    subjects: brief.subjects,
    narration,
    visuals: [],
    citations,
    targetDurationSec,
    structure: structureFor(brief, specs, hook.type, style),
    hook,
    beats,
    hookScore: hookGate.score,
    hookStyle: hookGate.style,
    title: `${brief.caseName}${yr}: the rise and the fallout`.slice(0, 100),
    description:
      (facts[0] ?? brief.summary.slice(0, 160)) +
      (copy ? ` ${capitalizeFirst(withArticle(copy.framing))} of the documented record.` : '') +
      ` Source: ${brief.wikipediaUrl}`,
    hashtags: ['history', 'business', 'documentary', 'storytime', 'didyouknow'],
  }
}
