// Seeds the F10 True Crime factory + its agent. Idempotent.
// Run with: node scripts/seed-truecrime.mjs
//
// Cases are curated historical (>100yr), public-record, ADULT principals — the
// safe profile the compliance gate is built around. One acquitted case (Borden)
// exercises the hedge path; the rest are convictions.
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
  caseWatchlist: [
    {
      caseName: 'The Lindbergh Kidnapping',
      wikipediaTitle: 'Lindbergh kidnapping',
      angle: "How the ransom note's handwriting cracked the case.",
      subjects: [
        { name: 'Bruno Hauptmann', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Lizzie Borden Case',
      wikipediaTitle: 'Lizzie Borden',
      angle: 'Why the evidence never convinced the jury.',
      subjects: [{ name: 'Lizzie Borden', role: 'acquitted', living: false, isMinor: false }],
    },
    {
      caseName: 'Leopold and Loeb',
      wikipediaTitle: 'Leopold and Loeb',
      angle: "The 'perfect crime' that unravelled over a pair of glasses.",
      subjects: [
        { name: 'Nathan Leopold', role: 'convicted', living: false, isMinor: false },
        { name: 'Richard Loeb', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Crippen Case',
      wikipediaTitle: 'Hawley Harvey Crippen',
      angle: 'The wireless telegraph arrest that made legal history.',
      subjects: [
        { name: 'Hawley Harvey Crippen', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The D. B. Cooper Hijacking',
      wikipediaTitle: 'D. B. Cooper',
      angle: 'The only unsolved skyjacking in US history — a man, a parachute, and $200,000 gone into the night.',
      subjects: [],
    },
    {
      caseName: 'The Zodiac Killer',
      wikipediaTitle: 'Zodiac Killer',
      angle: 'The taunting ciphers of a killer who was never caught — and the codes amateurs still crack decades later.',
      subjects: [],
    },
    {
      caseName: 'The Black Dahlia',
      wikipediaTitle: 'Black Dahlia',
      angle: "Hollywood's most infamous cold case — how a 1947 murder became an unsolvable legend.",
      subjects: [
        { name: 'Elizabeth Short', role: 'victim', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The Golden State Killer',
      wikipediaTitle: 'Golden State Killer',
      angle: 'How a genealogy database finally unmasked a serial predator four decades after the crimes went cold.',
      subjects: [
        { name: 'Joseph James DeAngelo', role: 'convicted', living: true, isMinor: false },
      ],
    },
    {
      caseName: 'The Great Train Robbery of 1963',
      wikipediaTitle: 'Great Train Robbery (1963)',
      angle: 'The £2.6 million heist that gripped Britain — meticulous planning undone by a single set of fingerprints.',
      subjects: [
        { name: 'Ronnie Biggs', role: 'convicted', living: false, isMinor: false },
        { name: 'Bruce Reynolds', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'The 1962 Alcatraz Escape',
      wikipediaTitle: 'June 1962 Alcatraz escape',
      angle: 'Papier-mâché heads, a raft of raincoats, and three men who vanished from the inescapable island.',
      subjects: [
        { name: 'Frank Morris', role: 'convicted', living: false, isMinor: false },
        { name: 'John Anglin', role: 'convicted', living: false, isMinor: false },
        { name: 'Clarence Anglin', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Bonnie and Clyde',
      wikipediaTitle: 'Bonnie and Clyde',
      angle: 'The Depression-era outlaw couple the public romanticised — and the ambush that ended the legend.',
      subjects: [
        { name: 'Bonnie Parker', role: 'accused', living: false, isMinor: false },
        { name: 'Clyde Barrow', role: 'accused', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Al Capone',
      wikipediaTitle: 'Al Capone',
      angle: 'The most feared mob boss in America, brought down not by murder charges but by his tax returns.',
      subjects: [
        { name: 'Al Capone', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Sacco and Vanzetti',
      wikipediaTitle: 'Sacco and Vanzetti',
      angle: 'Whether two immigrant anarchists were convicted on evidence or on politics.',
      subjects: [
        { name: 'Nicola Sacco', role: 'convicted', living: false, isMinor: false },
        { name: 'Bartolomeo Vanzetti', role: 'convicted', living: false, isMinor: false },
      ],
    },
    {
      caseName: 'Jack the Ripper',
      wikipediaTitle: 'Jack the Ripper',
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
