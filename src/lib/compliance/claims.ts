// Pull the load-bearing factual claims out of a narration so each can be sent
// through the ≥2-source corroboration rule. Uses Claude when ANTHROPIC_API_KEY
// is set (better at classifying conviction vs. charge vs. speculation), with a
// deterministic keyword heuristic as the offline/no-key fallback.

import type { Claim, ClaimType } from './types'

// Words that make a sentence a load-bearing factual assertion we must verify.
const LOAD_BEARING_CUES: Record<Exclude<ClaimType, 'general'>, RegExp> = {
  conviction: /\b(convicted|found guilty|pleaded guilty|sentenced|imprisoned)\b/i,
  charge: /\b(charged|indicted|arrested|accused|alleged)\b/i,
  acquittal: /\b(acquitted|exonerated|found not guilty|cleared)\b/i,
  victim: /\b(victim|killed|murdered|died|disappeared|abducted)\b/i,
  date: /\b(in \d{4}|on \w+ \d{1,2}|\d{4})\b/,
  location: /\b(in [A-Z][a-z]+(,| County| City))\b/,
  sentence: /\b(life in prison|\d+ years|death penalty|parole)\b/i,
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function classify(sentence: string): { type: ClaimType; loadBearing: boolean } {
  for (const [type, re] of Object.entries(LOAD_BEARING_CUES)) {
    if (re.test(sentence)) return { type: type as ClaimType, loadBearing: true }
  }
  return { type: 'general', loadBearing: false }
}

/** Best-effort: pick a proper-noun person name the sentence is about. */
function guessSubject(sentence: string, names: string[]): string | undefined {
  return names.find((n) => sentence.toLowerCase().includes(n.toLowerCase()))
}

export function heuristicExtractClaims(narration: string, subjectNames: string[]): Claim[] {
  return splitSentences(narration).map((text, i) => {
    const { type, loadBearing } = classify(text)
    return {
      id: `c${i + 1}`,
      text,
      type,
      loadBearing,
      subjectName: guessSubject(text, subjectNames),
      citations: [],
    }
  })
}

interface ClaudeClaim {
  text: string
  type: ClaimType
  loadBearing: boolean
  subjectName?: string
}

export async function extractClaims(
  narration: string,
  subjectNames: string[],
  authorCitations: string[] = []
): Promise<Claim[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return heuristicExtractClaims(narration, subjectNames)

  let parsed: ClaudeClaim[]
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: [
          {
            type: 'text',
            text:
              'You extract verifiable factual claims from true-crime narration for a fact-checking pipeline. ' +
              'Return ONLY a JSON array. Each item: {"text": exact sentence, "type": one of ' +
              '"conviction"|"charge"|"acquittal"|"victim"|"date"|"location"|"sentence"|"general", ' +
              '"loadBearing": boolean (true for charges, convictions, victim identity, and dates — anything that ' +
              'asserts who did what, legal status, or when), "subjectName": the named person it is about or omit}. ' +
              'Do not invent claims; only extract sentences present in the narration.',
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: `Known people: ${subjectNames.join(', ') || '(none given)'}\n\nNarration:\n${narration}`,
          },
        ],
      }),
    })
    if (!res.ok) return heuristicExtractClaims(narration, subjectNames)
    const data = await res.json()
    const text: string = data.content?.[0]?.text ?? ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return heuristicExtractClaims(narration, subjectNames)
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return heuristicExtractClaims(narration, subjectNames)
  }

  return parsed.map((c, i) => ({
    id: `c${i + 1}`,
    text: String(c.text ?? ''),
    type: (c.type ?? 'general') as ClaimType,
    loadBearing: Boolean(c.loadBearing),
    subjectName: c.subjectName,
    // Attach any author citation that mentions this subject as a starting point.
    citations: authorCitations,
  }))
}
