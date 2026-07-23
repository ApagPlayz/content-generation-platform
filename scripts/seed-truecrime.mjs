// Seeds the F10 True Crime factory + its agent. Idempotent.
// Run with: node scripts/seed-truecrime.mjs
//
// Cases are curated, public-record, CONCLUDED or historically-settled cases with
// ADULT principals — the safe profile the compliance gate is built around. Every
// entry has an `eventYear`; discovery prefers the NEWEST years first (modern
// cases — Unabomber, Oklahoma City, O.J., Waco, Lockerbie, Gacy … — have
// abundant public video & photos), falling back to the pre-1980 classics only
// once the recent band is exhausted or on cooldown. Acquitted cases (Borden,
// O. J. Simpson) exercise the hedge path; the rest are convictions or unsolved.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const FACTORY_NAME = 'True Crime'

const config = {
  description:
    'Faceless 60–90s narrated shorts on historical, adjudicated criminal cases. Public-domain archival visuals, documentary tone, 2-source fact-checking + defamation lint gate.',
  targetDurationSec: 75,
  maxImages: 6,
  // macOS `say` voice for the free local-TTS fallback; ElevenLabs voice id wins
  // if ELEVENLABS_API_KEY is set.
  voice: 'Daniel',

  // ── Footage / visuals surface. Every new feature is OFF/dormant by default so
  //    the demo pipeline keeps using the Wikimedia public-domain slideshow until
  //    the owner opts in. These document the new config keys downstream stages read.
  footageEnabled: true,
  maxClipsPerBeat: 2,
  maxImagesPerBeat: 2,
  // AI script writer (Claude) — off until an API key + opt-in are set.
  useAiScript: false,
  scriptModel: 'sonnet',
  // Pexels/Pixabay stock video — off (needs PEXELS_API_KEY / PIXABAY_API_KEY).
  useStockFootage: false,
  maxStockClipsPerBeat: 1,
  stockProviders: ['pexels', 'pixabay'],
  // archive.org public-domain footage — off; no key required when enabled.
  useArchiveFootage: true,
  archiveMaxClips: 3,
  archiveCollections: ['prelinger'],
  aiStillStyle: 'muted cinematic, symbolic, no faces',
  // Fallback ladder in tier-key vocabulary (ai_still | stock | archive | moodbank).
  // Each tier no-ops without its key/flag, then the visuals stage backfills the
  // keyless Wikimedia floor — so this is safe with zero API keys.
  footageLadder: ['archive'],
  // Archive footage as stills only for the PHOTO tier (no motion-blurred
  // poster-frames) — the photo backbone comes from Wikipedia/Commons + archive
  // stills. Real MOVING footage is handled by the separate clip layer below.
  archiveStillsOnly: true,

  // ── Relevant moving-clip layer (2026-07) ──────────────────────────────────
  //   Photos stay the backbone; these lay SHORT, relevance-filtered excerpts of
  //   real on-topic footage over a few beats (archive.org movies + YouTube
  //   fair-use news/court/bodycam/documentary). Muted, attributed, hard-capped.
  clipsEnabled: true,
  clipSources: ['archive', 'youtube'],
  maxClipBeats: 3,
  maxClipOnscreenSec: 8,
  clipRelevanceMinTokens: 1,
  youtubeClipSearchCount: 6,
  minClipHeight: 360,
  // Named visual styles rotated across videos for variety.
  styleRotation: ['sepia-archival', 'noir-contrast', 'muted-documentary'],
  // Editorial angles rotated to avoid "inauthentic content" sameness.
  editorialAngles: ['investigation', 'forensics', 'courtroom', 'aftermath'],
  styleDivergenceWindow: 5,
  enableEditorialLayer: true,
  // Mood-bank b-roll layer — dormant by default.
  moodBankEnabled: true,
  // Every entry carries an `eventYear` (the crime / arrest / conviction). Among
  // UNCOVERED, image-viable cases, discovery now prefers the NEWEST years first
  // (modern cases have abundant public video & photos), so the ~1980s–2000s
  // additions below lead the rotation and the old 1888–1947 classics fall to the
  // back until the recent band is exhausted or on cooldown.
  caseWatchlist: [
    // ── Recent, concluded / historically-settled cases (1980s–2000s) ──────────
    {
      caseName: 'The Unabomber',
      wikipediaTitle: 'Ted Kaczynski',
      eventYear: 1996,
      angle: "A Berkeley math prodigy waged a 17-year mail-bomb campaign from a Montana cabin — and it was his own brother who recognised the manifesto and turned him in.",
      subjects: [
        { name: 'Ted Kaczynski', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Oklahoma City Bombing',
      wikipediaTitle: 'Oklahoma City bombing',
      eventYear: 1995,
      angle: 'A rented truck full of fertilizer killed 168 people at a federal building — the deadliest act of homegrown terrorism in US history, cracked by a single traffic stop and a vehicle serial number.',
      subjects: [
        { name: 'Timothy McVeigh', role: 'convicted', living: false, isMinor: false },
        { name: 'Terry Nichols', role: 'convicted', living: true, isMinor: false },
      ],
    },
    {
      caseName: 'The O. J. Simpson Trial',
      wikipediaTitle: 'O. J. Simpson murder case',
      eventYear: 1994,
      angle: 'A football icon, a white Bronco chase watched by 95 million, and the most televised trial in history — how "the glove" turned a murder case into a verdict the country still argues over.',
      subjects: [
        { name: 'O. J. Simpson', role: 'acquitted', living: false, isMinor: false },
        { name: 'Nicole Brown Simpson', role: 'victim', living: false, isMinor: false },
        { name: 'Ron Goldman', role: 'victim', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Waco Siege',
      wikipediaTitle: 'Waco siege',
      eventYear: 1993,
      angle: 'A 51-day standoff between a doomsday sect and federal agents ended in a fire broadcast live to the world — and the fatal questions about who lit it that fuelled a generation of distrust.',
      subjects: [
        { name: 'David Koresh', role: 'accused', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Isabella Stewart Gardner Heist',
      wikipediaTitle: 'Isabella Stewart Gardner Museum theft',
      eventYear: 1990,
      angle: 'Two men in police uniforms talked their way into a Boston museum and walked out with half a billion dollars of art — the biggest property theft on record, still unsolved, the empty frames still hanging.',
      subjects: [],
    },
    {
      caseName: 'Ted Bundy',
      wikipediaTitle: 'Ted Bundy',
      eventYear: 1989,
      angle: 'A charming law student who confessed to 30 murders and escaped custody twice — the case that put the phrase "serial killer" into the American vocabulary.',
      subjects: [
        { name: 'Ted Bundy', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Lockerbie Bombing',
      wikipediaTitle: 'Pan Am Flight 103',
      eventYear: 1988,
      angle: 'A bomb the size of a cassette recorder brought down a jumbo jet over a Scottish town, killing 270 — the twelve-year investigation and the one conviction that never quite closed the case.',
      subjects: [
        { name: 'Abdelbaset al-Megrahi', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'John Wayne Gacy',
      wikipediaTitle: 'John Wayne Gacy',
      eventYear: 1980,
      angle: 'A respected contractor who performed as a clown at charity events buried 33 young men beneath his own house — how a single missing-person report unravelled the "Killer Clown."',
      subjects: [
        { name: 'John Wayne Gacy', role: 'convicted', living: false, isMinor: false },
      ],
    },
    // ── Classic historical cases (pre-1980) — the deep back-catalogue ─────────
    {
      caseName: 'The Golden State Killer',
      wikipediaTitle: 'Golden State Killer',
      eventYear: 1976,
      angle: 'How a genealogy database finally unmasked a serial predator four decades after the crimes went cold.',
      subjects: [
        { name: 'Joseph James DeAngelo', role: 'convicted', living: true, isMinor: false },
      ],
    },
    {
      caseName: 'The D. B. Cooper Hijacking',
      wikipediaTitle: 'D. B. Cooper',
      eventYear: 1971,
      angle: 'The only unsolved skyjacking in US history — a man, a parachute, and $200,000 gone into the night.',
      subjects: [],
    },
    {
      caseName: 'The Zodiac Killer',
      wikipediaTitle: 'Zodiac Killer',
      eventYear: 1969,
      angle: 'The taunting ciphers of a killer who was never caught — and the codes amateurs still crack decades later.',
      subjects: [],
    },
    {
      caseName: 'The Great Train Robbery of 1963',
      wikipediaTitle: 'Great Train Robbery (1963)',
      eventYear: 1963,
      angle: 'The £2.6 million heist that gripped Britain — meticulous planning undone by a single set of fingerprints.',
      subjects: [
        { name: 'Ronnie Biggs', role: 'convicted', living: false, isMinor: false },
        { name: 'Bruce Reynolds', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The 1962 Alcatraz Escape',
      wikipediaTitle: 'June 1962 Alcatraz escape',
      eventYear: 1962,
      angle: 'Papier-mâché heads, a raft of raincoats, and three men who vanished from the inescapable island.',
      subjects: [
        { name: 'Frank Morris', role: 'convicted', living: false, isMinor: false },
        { name: 'John Anglin', role: 'convicted', living: false, isMinor: false },
        { name: 'Clarence Anglin', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Black Dahlia',
      wikipediaTitle: 'Black Dahlia',
      eventYear: 1947,
      angle: "Hollywood's most infamous cold case — how a 1947 murder became an unsolvable legend.",
      subjects: [
        { name: 'Elizabeth Short', role: 'victim', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Bonnie and Clyde',
      wikipediaTitle: 'Bonnie and Clyde',
      eventYear: 1934,
      angle: 'The Depression-era outlaw couple the public romanticised — and the ambush that ended the legend.',
      subjects: [
        { name: 'Bonnie Parker', role: 'accused', living: false, isMinor: false },
        { name: 'Clyde Barrow', role: 'accused', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Lindbergh Kidnapping',
      wikipediaTitle: 'Lindbergh kidnapping',
      eventYear: 1932,
      angle: "How the ransom note's handwriting cracked the case.",
      subjects: [
        { name: 'Bruno Hauptmann', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Al Capone',
      wikipediaTitle: 'Al Capone',
      eventYear: 1931,
      angle: 'The most feared mob boss in America, brought down not by murder charges but by his tax returns.',
      subjects: [
        { name: 'Al Capone', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Leopold and Loeb',
      wikipediaTitle: 'Leopold and Loeb',
      eventYear: 1924,
      angle: "The 'perfect crime' that unravelled over a pair of glasses.",
      subjects: [
        { name: 'Nathan Leopold', role: 'convicted', living: false, isMinor: false },
        { name: 'Richard Loeb', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Sacco and Vanzetti',
      wikipediaTitle: 'Sacco and Vanzetti',
      eventYear: 1921,
      angle: 'Whether two immigrant anarchists were convicted on evidence or on politics.',
      subjects: [
        { name: 'Nicola Sacco', role: 'convicted', living: false, isMinor: false },
        { name: 'Bartolomeo Vanzetti', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Crippen Case',
      wikipediaTitle: 'Hawley Harvey Crippen',
      eventYear: 1910,
      angle: 'The wireless telegraph arrest that made legal history.',
      subjects: [
        { name: 'Hawley Harvey Crippen', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Lizzie Borden Case',
      wikipediaTitle: 'Lizzie Borden',
      eventYear: 1892,
      angle: 'Why the evidence never convinced the jury.',
      subjects: [{ name: 'Lizzie Borden', role: 'acquitted', living: false, isMinor: false }],
    },
    {
      caseName: 'Jack the Ripper',
      wikipediaTitle: 'Jack the Ripper',
      eventYear: 1888,
      angle: "London's Whitechapel murders — the unidentified killer whose legend built modern true crime.",
      subjects: [],
    },
  ],
}

const playbook = [
  'You are the True Crime factory agent. You produce documentary-tone short-form videos about',
  'historical, fully-adjudicated criminal cases. Your editorial values:',
  '- Investigation-and-resolution focus, never the violence.',
  '- Every load-bearing fact is sourced; you cite on-screen and in the description.',
  '- You never assert guilt about anyone not convicted; acquittals are stated as acquittals.',
  '- Each video has a unique angle and original framing — never a templated retread.',
].join(' ')

async function main() {
  const factory = await prisma.factory.upsert({
    where: { id: await existingId() },
    update: { config: JSON.stringify(config) },
    create: {
      name: FACTORY_NAME,
      type: 'F10',
      config: JSON.stringify(config),
      postingDefaults: JSON.stringify({ autonomy: 'review' }),
    },
  })

  await prisma.agent.upsert({
    where: { factoryId_name: { factoryId: factory.id, name: 'True Crime Agent' } },
    update: { playbook, budget: 5 },
    create: {
      factoryId: factory.id,
      name: 'True Crime Agent',
      autonomy: 'review',
      playbook,
      budget: 5,
      enabled: true,
    },
  })

  console.log(`✓ Seeded F10 factory "${FACTORY_NAME}" (${factory.id}) + agent.`)
}

// upsert needs a where-unique; find existing F10 factory by name or use a sentinel.
async function existingId() {
  const found = await prisma.factory.findFirst({ where: { name: FACTORY_NAME, type: 'F10' } })
  return found?.id ?? 'f10-does-not-exist'
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
