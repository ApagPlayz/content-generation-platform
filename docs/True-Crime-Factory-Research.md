# True Crime Factory (F10) — Build Research

**Status:** Research complete (2026-06-10). Pre-build.
**Scope:** Tooling + legal/policy research for the F10 "True Crime" content factory — 45–60s narrated short-form videos about real criminal cases, cold cases, unsolved mysteries, historical crimes. Faceless assembly (narration over visuals). Local-first (Next.js + BullMQ workers + Claude API). Lean budget target <$50/mo.

---

## ⚠️ Two findings that reshape the plan

### 1. YouTube's "inauthentic content" policy (July 2025) is the #1 existential risk
YouTube renamed "repetitious content" → **"inauthentic content"** and explicitly targets *"mass-produced or repetitive content… content that looks like it's made with a template with little to no variation… AI-generated content made with generic templates giving the impression of mass production without adding the creator's original, authentic insights."* Violation can **demonetize the entire channel**, not one video.

- AI is **NOT** banned — AI-assisted channels stay monetizable **if** each video has unique human-added value, original analysis, and real variation in structure/visuals.
- **Implication for our factory:** a naive "same template, narration-over-slideshow, N videos/day" agent is exactly the demonetization profile. The F10 agent MUST enforce per-video variation (unique angle/analysis, varied structure & visuals) and keep a human review gate that adds original value. Build this into the playbook + pipeline, not as an afterthought.
- Source: https://support.google.com/youtube/answer/1311392 · https://www.socialmediatoday.com/news/youtube-clarifies-monetization-update-inauthentic-repeated-content/752892/

### 2. Short-form alone barely earns; the money is long-form
- YouTube **long-form** true crime RPM ≈ **$5–10** (high-CPM niche; example channel ~$120K/yr). YouTube **Shorts** RPM ≈ **$0.05–0.15**.
- **TikTok Creator Rewards requires videos ≥1 min** — so 45–60s clips earn **$0** on TikTok rewards, and need 10K followers + 100K views/30d to qualify at all.
- **Implication:** treat Shorts/TikTok as a **funnel**, not the revenue engine. Strategy should support producing ≥1-min videos (TikTok eligibility) and ideally an 8–15 min YouTube long-form variant of the same researched case. Worth a factory config option for target duration.

---

## Recommended pipeline stack (Lean tier ≈ $0–22/mo)

| Stage | Tool (Lean) | Cost | Premium upgrade |
|---|---|---|---|
| **Case discovery + facts** | Wikidata SPARQL + Wikipedia API | Free | — |
| **News context** | GDELT (+ GNews free tier) | Free | — |
| **Ideation signal** | Reddit API (r/UnresolvedMysteries) ⚠️ needs 2025 pre-approval | Free | — |
| **Trend / competitor radar** | YouTube Data API v3 (`chart=mostPopular` = 1 unit) | Free | — |
| **Search-demand trends** | Google Trends API alpha (apply) → Apify free actor fallback | Free | — |
| **Legal-status verify** | CourtListener / RECAP | Free (basic) | paid membership if volume |
| **Historical visuals (PD)** | LoC loc.gov API + Chronicling America + NARA Catalog | Free, no key | — |
| **More PD/CC images** | Wikimedia Commons (filter PD/CC0) + Flickr Commons | Free | — |
| **Generic b-roll** | Pexels API + Pixabay API | Free | Storyblocks ($30/mo, license expires on cancel!) |
| **Script / decisioning** | Claude API (sonnet bulk, opus for hero scripts) | ~tokens | — |
| **Voiceover (TTS)** | Kokoro-82M local (Apache 2.0) **or** ElevenLabs Starter | $0 / $6 | ElevenLabs Creator $22 / Pro $99 (voices: Arnold/James/"AZ") |
| **Atmospheric images** | Flux Schnell via Replicate (~$0.003/img) **or** local SD | ~$0 | Flux 1.1 Pro / Imagen 4 ($0.04); Ideogram Turbo for on-image text |
| **Transcription / captions** | whisper.cpp via `@remotion/install-whisper-cpp` (`tokenLevelTimestamps: true`) | Free | WhisperX (forced-align accuracy) |
| **Ken Burns / animation / mix** | Inside Remotion (CSS transforms + `<Audio>`) | — | — |
| **Compositor** | **Remotion** (`renderMedia()` in BullMQ worker) | Free ≤3 ppl | ~$100/mo "Automators" tier above 3 ppl |
| **Final encode** | ffmpeg via `child_process` (libx264 high/crf19/yuv420p/+faststart/aac192k/loudnorm -14) | Free | — |
| **Music** | Pixabay Music API + YouTube Audio Library / Uppbeat free | Free | Mubert API ($14–39, generative, has dev API) or Epidemic Sound |

**Net Lean monthly: ~$0–6** for tooling (just optional ElevenLabs Starter), leaving the budget for Claude tokens.

### Key tooling gotchas
- **Remotion** is BUSL-licensed: **free for ≤3 people**, but an automated factory at a larger/commercial org falls under the **"Automators" tier (~$0.01/render, $100/mo min)**. Confirm team size. If zero-license-fee is a hard requirement, the fallback compositor is **Revideo** (MIT, self-host) — but it has maintenance-momentum risk (team pivoted to commercial Midrender).
- **fluent-ffmpeg was archived (May 2025)** — call ffmpeg via `child_process` directly.
- **ElevenLabs free plan = no commercial use + forced attribution.** Must be Starter+ ($6) to publish.
- **Storyblocks standard license expires when you cancel** — don't cancel while videos using its assets are live.
- **Play.ht is dead** (Meta acquisition, shut Dec 2025).
- **Flux:** Schnell is Apache 2.0 (use anywhere); Dev weights are non-commercial — only the *hosted API* grants commercial rights.
- **Midjourney has no official API** — automation tools violate ToS.
- **pytrends is dead** (archived Apr 2025) — use official Trends API alpha or Apify.
- **Reddit (2025)** requires pre-approval for ALL API use, even personal. Use as *signal*, not a content source.
- **TikTok** has no usable free official API for solo operators; scraping violates ToS. Use YouTube + Google Trends as demand proxies.

### Render performance (local)
60s 1080×1920 video in Remotion on an 8–16 core machine ≈ **2–5 min render** + sub-realtime whisper.cpp + a few sec ffmpeg. ~2–4GB RAM per concurrent render; parallelism *within* a single render plateaus, so run a small number of BullMQ workers each pinned to a CPU subset, bundle once at worker boot. Non-blocking (async, work happens in spawned Chromium/ffmpeg).

---

## Assembly pipeline architecture (deterministic + idempotent BullMQ stages)

Each stage writes to `work/{jobId}/`; derive artifact filenames from a hash of inputs; on retry skip if artifact exists with matching input hash. Never mutate in place.

```
Stage 0  Resolve assets   script.json + image list + audio → validate, hash inputs → jobId
Stage 1  TTS / narration  → narration.wav (mono/16k for whisper + 48k master)
Stage 2  Transcribe       whisper.cpp (tokenLevelTimestamps) → toCaptions() → captions.json
Stage 3  Beat matching    align image list to caption timestamps → timeline.json
Stage 4  Render           Remotion bundle() (cached) → renderMedia() with inputProps
                          {timeline, captions, audioSrc, musicSrc} → render.mp4
                          (Ken Burns + captions + music bed all INSIDE Remotion)
Stage 5  Final encode     ffmpeg → platform-spec variants (9:16, loudnorm, faststart)
Stage 6  Publish
```

Captions: `transcribe({tokenLevelTimestamps:true})` → `toCaptions()` → `createTikTokStyleCaptions({combineTokensWithinMilliseconds})` → render pages with `spring()` highlight. Start from the official Remotion TikTok template.

Final-encode ffmpeg pattern:
```bash
ffmpeg -i render.mp4 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1" \
  -c:v libx264 -profile:v high -preset slow -crf 19 \
  -pix_fmt yuv420p -g 60 -bf 2 -movflags +faststart \
  -c:a aac -b:a 192k -ar 48000 \
  -af "loudnorm=I=-14:TP=-1.0:LRA=11" \
  final.mp4
```

---

## Fact-checking / verification (free, layered)
- **2-source corroboration rule:** every load-bearing claim (charges, conviction, victim, dates) must appear in ≥2 independent sources (Wikipedia/Wikidata + GDELT/GNews + CourtListener for legal status). Claude scripting step outputs claims-with-citations; reject scripts with single-sourced load-bearing claims.
- **Legal-status verify** via CourtListener to avoid asserting guilt for the acquitted/merely-charged.
- **Defamation lint pass:** flag any script naming a living, non-convicted person alongside guilt-asserting verbs → route to human review.

---

## Risk-mitigation checklist (encode into the F10 agent)

**Case selection:**
- [ ] Only **convicted, historical (>~50 yrs), or fully adjudicated/public-record** cases. Reject open cases with named living accused.
- [ ] **Never name or depict minors** (victims or perpetrators). Child abuse content is **permanently demonetized** on YouTube.
- [ ] Block identifiable living accused-but-not-convicted unless strict "alleged" framing tied to court records.
- [ ] Don't identify/characterize uninvolved family members.

**Language:**
- [ ] Force "alleged"/"accused"/"reportedly" for any non-adjudicated assertion about a named living person.
- [ ] Require a cited source for every factual claim; show citations on-screen + in description.
- [ ] No speculation as fact; don't name "the real killer" in unsolved cases.

**Visuals/audio:**
- [ ] Prefer **federal/public-domain images** (FBI/US Marshals mugshots = PD). State/local mugshots = fair-use-commentary only (newsworthy, transformative, attributed); log source + license per asset.
- [ ] **No raw news clips or press photos** without a license.
- [ ] **No realistic AI-generated likenesses of real people** (living or dead) — biggest emerging-risk rule (TikTok "resurrected victims" backlash). Use abstract/symbolic AI visuals or PD/licensed imagery.
- [ ] Music only from YouTube Audio Library / Creator Music / licensed library, license ID logged.
- [ ] **No gore, crime-scene, autopsy, or violence-focal imagery** (advertiser-friendly compliance).

**Platform compliance:**
- [ ] Auto-set YouTube **AI-disclosure flag** at upload for realistic synthetic visuals / AI music. Add TikTok/IG AI labels. (A synthetic narrator voice not impersonating a real person generally doesn't trigger disclosure; AI visuals depicting the real case do.)
- [ ] **Defeat the inauthentic-content trap:** enforce real per-video variation — unique scripting, original analysis, varied structure/visuals, human review pass before publish.
- [ ] Documentary/educational tone; investigation-and-resolution focus, not the violence.
- [ ] For TikTok monetization, produce **≥1-min** videos (45–60s earns $0 on Creator Rewards).

**Strategic:**
- [ ] Pivot revenue toward YouTube **long-form** ($5–10 RPM); Shorts/TikTok as funnel.
- [ ] Keep a human-in-the-loop legal/edit gate (the operator adds the "original value" that survives the inauthentic-content policy and catches defamation).

**Jan 2026 YouTube relaxation (favorable):** non-graphic discussion of domestic abuse, sexual abuse, suicide, self-harm, abortion, and violent law-enforcement interactions can now earn full ad revenue. Still permanently demonetized: child abuse, child sex trafficking, eating disorders.

---

## Sources
Condensed; full URLs captured per-claim during research. Primary: YouTube monetization & AI-disclosure policy pages, TikTok/Meta community guidelines, Remotion license/docs, ElevenLabs/OpenAI/Replicate/fal pricing, LoC/NARA/Wikimedia API docs, GDELT, CourtListener, true-crime RPM analyses (fluxnote, Flippa), defamation case coverage (Rolling Stone — Gypsy Rose Blanchard suit; AI-victim backlash).
