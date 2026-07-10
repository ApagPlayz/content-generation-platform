// Claim-tolerance policy for sports leagues (F9). Copyright/reused-content risk
// varies a lot by rights-holder: the NBA is comparatively tolerant of short
// fan-made highlight clips, whereas the NFL and UFC are rights-aggressive and
// issue takedowns / channel strikes readily. This module is a pure helper — no
// I/O — that classifies a trigger's league so source.ts can favor tolerant
// leagues, FLAG aggressive ones (route to review, never auto-publish) and, if
// the operator opts in, hard-BLOCK a league from running at all.
//
// This is risk MITIGATION, not a legal guarantee — the flag surfaces in the
// review inbox so a human decides before anything ships.

export type LeagueTolerance = 'favor' | 'flag' | 'block' | 'unknown'

export interface LeaguePolicyConfig {
  favor?: string[]
  flag?: string[]
  block?: string[]
}

export interface LeagueClassification {
  league: string
  tolerance: LeagueTolerance
  note: string
}

/** Baseline stance used when the factory config doesn't override a league. */
export const LEAGUE_POLICY: Record<string, LeagueTolerance> = {
  nba: 'favor',
  wnba: 'favor',
  nfl: 'flag',
  ufc: 'flag',
  nhl: 'flag',
  mlb: 'flag',
}

const LEAGUE_KEYWORDS: Record<string, string> = {
  nba: 'nba',
  wnba: 'wnba',
  nfl: 'nfl',
  ufc: 'ufc',
  mma: 'ufc',
  nhl: 'nhl',
  mlb: 'mlb',
}

function sniffLeague(query?: string): string | null {
  if (!query) return null
  const q = query.toLowerCase()
  for (const [kw, league] of Object.entries(LEAGUE_KEYWORDS)) {
    if (new RegExp(`\\b${kw}\\b`).test(q)) return league
  }
  return null
}

function noteFor(league: string, tolerance: LeagueTolerance): string {
  const L = league.toUpperCase()
  switch (tolerance) {
    case 'favor':
      return `${L} is comparatively claim-tolerant for short highlight clips`
    case 'flag':
      return `${L} rights-aggressive — route to review, do not auto-publish`
    case 'block':
      return `${L} blocked by factory policy — trigger skipped`
    default:
      return `${L} unknown claim-tolerance — treat with caution`
  }
}

/**
 * Classify the league behind a sourcing trigger.
 *
 * Precedence: explicit config lists (block > flag > favor) win, then the
 * baseline LEAGUE_POLICY map, then 'unknown'. The league name is read from
 * config.league / config.sport when set, else sniffed from the YouTube query.
 */
export function classifyLeague(
  config: { league?: string; sport?: string; leaguePolicy?: LeaguePolicyConfig },
  _strategy: string,
  query?: string
): LeagueClassification {
  const policy = config.leaguePolicy ?? {}
  const explicit = String(config.league ?? config.sport ?? '').toLowerCase().trim()
  const league = explicit || sniffLeague(query) || 'unknown'

  const inList = (list?: string[]) =>
    Array.isArray(list) && list.map((s) => String(s).toLowerCase()).includes(league)

  let tolerance: LeagueTolerance
  if (inList(policy.block)) tolerance = 'block'
  else if (inList(policy.flag)) tolerance = 'flag'
  else if (inList(policy.favor)) tolerance = 'favor'
  else tolerance = LEAGUE_POLICY[league] ?? 'unknown'

  return { league, tolerance, note: noteFor(league, tolerance) }
}
