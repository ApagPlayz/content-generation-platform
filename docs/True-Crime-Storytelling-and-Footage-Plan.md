# True Crime: Storytelling + Real Footage — Implementation Plan

Captured 2026-06-22. Addresses three gaps the owner raised about F10 crime videos:

1. **No real video** — visuals are still photos with a Ken-Burns zoom only.
2. **No dramatic arc** — narration is one flat block; no rising action / climax / tension.
3. **No deliberate hooks** — the opening doesn't reliably stop the scroll.

This plan is research-backed (sources at the end) and mapped to the actual files.

---

## 1. Where the code is today

| Concern | Current behaviour | File |
|---|---|---|
| Script | One block of narration from Claude (or a template). A `HOOK_PATTERNS` label exists but isn't a real hook; no beats, no per-section timing. | `src/lib/truecrime/script.ts` |
| Visuals | Stills only, from Wikimedia Commons. Compliance model **already supports `kind: 'video'`** and AI **non-person** b-roll (with disclosure). | `src/lib/truecrime/visuals.ts`, `src/lib/compliance/visualLint.ts` |
| Render | Ken-Burns slideshow over stills (ffmpeg) **or** the new Remotion karaoke composition. Both drive captions evenly; no beat-aware pacing. | `src/lib/truecrime/assemble.ts`, `video/TrueCrime.tsx`, `src/lib/render/remotion.ts` |
| Compliance | Strong gate: claims/corroboration, defamation lint, hedges guilt for non-convicted, blocks realistic AI likeness of real people, no minors. | `src/lib/compliance/**` |

The key insight: **a beat-structured script is the backbone that fixes all three problems at once** — beats give us the dramatic arc, beat #1 is the engineered hook, and each beat's `visual_cue` is exactly what we feed the footage search.

---

## 2. Research synthesis (the load-bearing facts)

**Footage (how to get real motion, legally):**
- **Pexels Videos API** is the best default: free key, JSON, 9:16 portrait, commercial license, **no attribution required**, no real-person/copyright exposure for generic mood clips. `GET https://api.pexels.com/v1/videos/search?query=...&orientation=portrait` with `Authorization: KEY`. ~200 req/hr free, unlimited on request.
- **Pixabay Video API** is the fallback (`https://pixabay.com/api/videos/?key=KEY&q=...`) — free, commercial, **must cache responses 24h per ToS**.
- **Generic, person-free atmospheric b-roll is the safe default** (rain on glass, night driving, empty courtroom, forest, police lights, documents). It sidesteps copyright, defamation/right-of-publicity, and platform AI-likeness rules simultaneously. A May 2026 $17.5M defamation verdict against a true-crime YouTuber underlines why we never use real footage of the actual people/case.
- **Free, keyless "motion without footage" multipliers** (Remotion): 2.5D parallax on stills, film-grain/vignette/light-leak overlays, document/newspaper push-ins, animated location maps. Biggest perceived-quality jump for zero licensing risk.
- **AI text-to-video** (Runway has the cleanest commercial license) is a paid, **non-person**, AI-disclosed gap-filler — not a bulk source.

**Hooks:**
- The first **2–3 seconds decide the swipe.** Target **>65–70% 3-second retention** (≈3–7× more distribution).
- Fire **three layers at once**: opening **visual** + **on-screen text** (≤7 words, compressed) + **calm verbal** line (10–14 words). Text must NOT duplicate the spoken line.
- Generate **8–10 type-diverse candidates** (open-loop, statistic, question, in-media-res, contradiction, overlooked-detail, timeline, unresolved-mystery), **score, then filter** through two hard gates: *payoff-mapped* (the script resolves the loop) and *compliance* (no asserted guilt; attributed; no gore). **Re-validate server-side — never trust the LLM's self-report.**

**Narrative structure / tension:**
- 60s ≈ **155–170 words / 7 beats**; 90s ≈ **235–260 words / 9 beats** (at ~2.7 words/sec).
- **Climax lands at 75–85% of runtime**, with a **mid-video re-hook** (~30s on a 60s cut) to fight the mid-video sag.
- Beats must link with **"but" / "therefore"**, never "and then" (causal, not sequential).
- Devices: open/nested loops, foreshadowing, escalating stakes, rule of three, pacing acceleration, cliffhanger close.
- **Visual cut cadence escalates with the arc:** 3–4s (setup) → 2–2.5s (rising) → 1–1.5s (climax). Pop the load-bearing word in captions at each reveal.
- **Tension must come from documented unresolved facts and attributed claims**, not speculation — which is both more compliant *and* more compelling.

---

## 3. Target design

### 3a. Beat-structured script (new backbone)

Replace the single-narration output with a **beat array**. Per-beat schema:

```ts
interface ScriptBeat {
  name: string                 // "Hook" | "Setup" | "Inciting detail" | "Rising 1" | ...
  index: number
  narration: string
  targetSeconds: number
  linkWord?: 'but' | 'therefore'   // required on beats after the hook
  visualCue: string            // search phrase for footage, e.g. "empty courtroom at night"
  cutIntervalSec: number       // 3.5 setup → 1.2 climax
  musicIntensity: number       // 0..1, rises with the arc
  captionEmphasisWord?: string // word to pop
  sourceAttribution?: string   // required if the beat carries a contested claim
  complianceFlag: 'factual' | 'attributed' | 'opinion-clear'
}
```

`F10Script` gains `beats: ScriptBeat[]` and `hook: HookCandidate`. The plain `narration` becomes `beats.map(b => b.narration).join(' ')` so TTS/captions still work unchanged.

### 3b. Hook generation + selection

A sub-step of the script stage:
1. Ask Claude for **8–10 typed candidates** (JSON) with `{type, verbal, onscreenText, visualSuggestion, opensLoop, payoffRef}`.
2. Score each (curiosity, specificity, brevity) and **hard-filter** on the two gates, re-checked server-side against the fact sheet and the existing defamation lint.
3. Select the top survivor → becomes beat #1 (verbal) + the opening on-screen text + opening visual cue.

### 3c. Footage strategy (fixes "just zooming")

For each beat, source a clip in this priority order, capped per video, all logged with license:
1. **Pexels video** matching `visualCue` (primary).
2. **Pixabay video** fallback (cached 24h).
3. **Wikimedia still** (existing) with **2.5D parallax + grain** so even stills move.
4. **Solid mood card** fallback (existing).

Hard rule, enforced in the selector + visual lint: **generic, person-free clips only** — no identifiable real people, never the real case footage. Tag clips `kind: 'video'`; AI clips get the synthetic-content disclosure flag.

### 3d. Remotion render upgrades

`video/TrueCrime.tsx` becomes beat-driven:
- Lay out clips/stills on the **beat timeline** with escalating **cut cadence**.
- `<OffthreadVideo>` for b-roll clips; Ken-Burns + **parallax** for stills.
- **Film-grain + vignette** overlay for cohesion; **document/newspaper push-in** and **animated map** beat types.
- Karaoke captions (already built) gain **emphasis-word pop**.
- Optional **escalating music bed** synced to `musicIntensity`.

---

## 4. Phased plan (each phase ships independently)

### Phase 1 — Beat-structured scripts + engineered hooks  *(biggest narrative win; no new keys)*
- `types.ts`: add `ScriptBeat`, `HookCandidate`; extend `F10Script`.
- `script.ts`: new beat+hook generation (60s=7 / 90s=9 beats, but/therefore linking, climax at ~80%), candidate-generate-score-filter for the hook, derive `narration` from beats.
- `compliance/`: run each beat through claims/defamation lint; validate the selected hook; require `sourceAttribution` on contested beats.
- Captions already consume the joined narration — no change needed to ship audio.
- **Outcome:** real rising action, a climax, and a deliberate hook — even before any footage work.

### Phase 2 — Real motion b-roll via Pexels  *(fixes "no videos"; needs 1 free API key)*
- `visuals.ts`: add `sourcePexelsVideo(visualCue)` + Pixabay fallback (24h cache), driven by each beat's `visualCue`; tag `kind:'video'`; log license; keep stills as fallback.
- `render/remotion.ts`: pass clip URLs + the beat timeline; serve the media dir (content-type already handles mp4).
- `video/TrueCrime.tsx`: render clips with `<OffthreadVideo>` interleaved with stills.
- `assemble.ts` (ffmpeg fallback): concat downloaded clips when present, else current slideshow.
- **Outcome:** actual moving footage matched to the narration.

### Phase 3 — Remotion motion/tension layers  *(polish; free, keyless)*
- Escalating cut cadence per beat; caption emphasis-word pop.
- Film-grain + vignette overlay; document/newspaper push-in; animated location map beat type.
- 2.5D parallax on stills (subtle).
- **Outcome:** cohesive, cinematic, tension-paced edit.

### Phase 4 — Music + optional AI gap-filler  *(optional)*
- Escalating royalty-free mood-music bed synced to `musicIntensity` (add audio AI-disclosure if AI music).
- AI text-to-video (non-person, disclosed) for atmospheric shots stock can't cover.

**Recommended order:** Phase 1 then Phase 2 as the core (the beat `visualCue`s are what make footage selection good), then Phase 3 polish. Phase 4 is optional.

---

## 5. What the owner needs to provide

- **A free Pexels API key** (and optionally a free Pixabay key) for Phase 2 — created in ~2 minutes at pexels.com/api. Stored in `.env.local` as `PEXELS_API_KEY`. Until then, Phase 1 + Phase 3 still work on stills.

## 6. Compliance guardrails (unchanged philosophy, extended)

- Footage: generic/person-free only; no real case footage; license logged per clip; AI clips flagged for synthetic-content disclosure (existing `buildDisclosurePlan`).
- Script: every contested beat attributed + sourced; "alleged/accused/charged" for non-convicted people; tension from documented unresolved facts, never asserted guilt; no gore; no minors.
- All of the above is re-validated server-side by the existing `src/lib/compliance/` gate — the LLM's self-reported compliance is never trusted.

---

## Sources
Footage/licensing: Pexels API docs & license; Pixabay API docs & license; Internet Archive / LoC / NASA / Wikimedia Commons APIs; Coverr; Runway/Luma/Pika licensing; WSMV $17.5M Kiely Rodni defamation verdict; right-of-publicity analyses; sniklaus/3d-ken-burns.
Hooks: go-viral, TTS Vibes & OpusClip 3s-retention data; Loewenstein information-gap & Zeigarnik effect; socialcoach visual+verbal hooks; invideo true-crime formats; YouTube defamation policy.
Structure: Influencers-Time three-act briefs; South Park but/therefore rule; open-loop/Zeigarnik refs; YouTube retention benchmarks 2026; caption WPM best practices; Cornell LII defamation.
(Full URLs in the 2026-06-22 research session.)
</content>
</invoke>
