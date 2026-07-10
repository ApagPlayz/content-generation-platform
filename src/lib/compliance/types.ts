// F10 True Crime — fact-checking + compliance layer contracts.
//
// The gate takes a TrueCrimeScript (case + people + narration + visuals + the
// citations the author attached) and runs five independent checks. Each check
// can BLOCK (hard stop), ESCALATE (route to a human review gate), or PASS. The
// gate combines them into one decision. See docs/True-Crime-Factory-Research.md
// for the policy rationale behind every rule here.

// ─────────────────────────── Input ───────────────────────────

export type SubjectRole =
  | 'accused' // charged but not (yet) convicted
  | 'convicted' // adjudicated guilty
  | 'acquitted' // tried and found not guilty
  | 'victim'
  | 'witness'
  | 'investigator'
  | 'other'

export interface CaseSubject {
  name: string
  role: SubjectRole
  /** Living people get the strictest defamation treatment. */
  living: boolean
  /** Minors (victims OR perpetrators) are a hard block — never named/depicted. */
  isMinor: boolean
}

export type ClaimType =
  | 'conviction'
  | 'charge'
  | 'acquittal'
  | 'victim'
  | 'date'
  | 'location'
  | 'sentence'
  | 'general'

export interface Claim {
  /** Stable id within a script (c1, c2…) for cross-referencing in the report. */
  id: string
  /** The assertion exactly as it appears in the narration. */
  text: string
  type: ClaimType
  /** Charges, conviction, victim identity, and dates must be ≥2-source verified. */
  loadBearing: boolean
  /** Named person the claim is about, if any (used by the defamation lint). */
  subjectName?: string
  /** URLs the script author attached as evidence for this claim. */
  citations: string[]
}

export type AssetLicense =
  | 'public_domain' // FBI/US Marshals mugshots, pre-1929 works, NARA/LoC
  | 'cc0'
  | 'cc_by'
  | 'fair_use' // state/local mugshot used as transformative commentary — log it
  | 'licensed' // Storyblocks/Pexels/Pixabay with retained license id
  | 'ai_generated'
  | 'unknown'

export interface VisualAsset {
  kind: 'image' | 'video' | 'music'
  /** Where it came from (url/provider) — logged per the asset-provenance rule. */
  source: string
  license: AssetLicense
  /** True if it shows a real person involved in the case (living or dead). */
  depictsRealPerson: boolean
  aiGenerated: boolean
  /** License id / attribution string, required for fair_use and licensed. */
  licenseRef?: string
  /** Beat index this asset was sourced for; set by the per-beat footage stage. */
  beatIndex?: number
}

export interface TrueCrimeScript {
  caseName: string
  subjects: CaseSubject[]
  /** Full narration text the TTS stage will read. */
  narration: string
  /** Pre-extracted claims; if omitted the gate extracts them from narration. */
  claims?: Claim[]
  visuals?: VisualAsset[]
  /** Author-attached source URLs (also fed into per-claim citation matching). */
  citations?: string[]
  /** Target seconds — TikTok Creator Rewards needs ≥60s; flagged if shorter. */
  targetDurationSec?: number
  /** Structural signature inputs for the inauthentic-content variation check. */
  structure?: ScriptStructure
}

/** Coarse shape of the video, used only to detect template mass-production. */
export interface ScriptStructure {
  /** e.g. "cold-open question" | "timeline" | "myth-bust" | "courtroom-reveal" */
  hookPattern: string
  /** Ordered section labels, e.g. ["hook","victim","investigation","verdict"]. */
  sections: string[]
  visualStyle: string
  /** Rotated editorial/commentary framing (e.g. "forensic-breakdown"); a real
   *  divergence axis so two videos with the same look but different analysis
   *  don't read as the same template. */
  editorialAngle?: string
}

// ─────────────────────────── Source verification ───────────────────────────

export type SourceName = 'wikipedia' | 'wikidata' | 'courtlistener' | 'gdelt'

export interface SourceHit {
  source: SourceName
  url: string
  title: string
  snippet: string
  /** 0..1 fuzzy match of the claim against the source text. */
  confidence: number
}

export interface CorroborationResult {
  claim: Claim
  hits: SourceHit[]
  /** Distinct independent sources that corroborated above threshold. */
  independentSourceCount: number
  /** True once a load-bearing claim hits ≥2 independent sources. */
  corroborated: boolean
}

// ─────────────────────────── Legal status ───────────────────────────

export type LegalStatus =
  | 'convicted'
  | 'acquitted'
  | 'exonerated'
  | 'charged_pending'
  | 'historical' // >~50yr / public-record; guilt freely assertable
  | 'unknown'

export interface LegalStatusResult {
  name: string
  status: LegalStatus
  evidence: SourceHit[]
  /** Can the script assert this person's guilt as fact? */
  guiltAssertable: boolean
  notes: string
}

// ─────────────────────────── Defamation lint ───────────────────────────

export interface DefamationFlag {
  severity: 'block' | 'review' | 'warn'
  /** The offending sentence/phrase. */
  span: string
  reason: string
  subjectName?: string
  /** A hedged rewrite the operator can drop in. */
  suggestedRewrite?: string
}

// ─────────────────────────── Case selection ───────────────────────────

export interface CaseSelectionVerdict {
  allowed: boolean
  /** Hard stops — gate returns `block`. */
  hardBlocks: string[]
  /** Soft concerns — gate returns `route_to_review`. */
  warnings: string[]
}

// ─────────────────────────── Visual / audio lint ───────────────────────────

export interface VisualFlag {
  severity: 'block' | 'review' | 'warn'
  asset: VisualAsset
  reason: string
}

// ─────────────────────────── Variation ───────────────────────────

export interface VariationVerdict {
  passed: boolean
  /** Max structural similarity (0..1) against recent F10 videos. */
  maxSimilarity: number
  /** Max visual-footage overlap (0..1) against recent F10 videos — catches the
   *  same photos/clips reused across videos, which the text/structure axes miss. */
  visualSimilarity?: number
  reasons: string[]
}

// ─────────────────────────── Disclosure ───────────────────────────

export interface DisclosurePlan {
  /** Realistic synthetic visuals of the real case → set YT/TikTok/IG AI flag. */
  requiresAiVisualLabel: boolean
  /** AI music → label. */
  requiresAiAudioLabel: boolean
  notes: string[]
}

// ─────────────────────────── Overall ───────────────────────────

export type GateDecision = 'pass' | 'route_to_review' | 'block'

export interface ComplianceReportJSON {
  caseName: string
  decision: GateDecision
  caseSelection: CaseSelectionVerdict
  corroboration: CorroborationResult[]
  legalStatus: LegalStatusResult[]
  defamation: DefamationFlag[]
  visuals: VisualFlag[]
  variation: VariationVerdict | null
  disclosure: DisclosurePlan
  /** Human-readable one-paragraph rollup. */
  summary: string
  generatedAt: string
}
