// Props contract shared between the composition and the server-side renderer
// (src/lib/render/remotion.ts). Keep this in sync with the inputProps built
// there — they are passed verbatim to selectComposition()/renderMedia().

export interface SportsHighlightProps {
  /** HTTP(S) URL of the source reel. Remotion's pipeline rejects file://, so
   *  the renderer serves the local file over an ephemeral localhost server. */
  videoSrc: string
  /** Moment window in seconds, relative to the source reel. */
  startSec: number
  endSec: number
  /** Hook line burned in as an animated, word-by-word caption. */
  hook: string
  /** Composition frame rate; also used to convert the window to frames. */
  fps: number
}

// ── F10 True Crime: karaoke slideshow ──────────────────────────────────────

/** One word inside a caption page, with its spoken time window (seconds). */
export interface CaptionToken {
  text: string
  startSec: number
  endSec: number
}

/** A ~3-word caption page. `tokens` drive word-by-word (karaoke) highlighting;
 *  when absent the whole page is shown without per-word emphasis. */
export interface CaptionCue {
  text: string
  startSec: number
  endSec: number
  tokens?: CaptionToken[]
}

/** One segment of the per-beat stitched timeline. `startFrame`/`durationInFrames`
 *  are on the composition fps grid (server converts seconds→frames on the
 *  running cumulative total). `inSec` is the trim start into a source video. */
export interface BeatClip {
  src: string
  kind: 'video' | 'image'
  startFrame: number
  durationInFrames: number
  inSec?: number
}

export interface TrueCrimeProps {
  /** HTTP(S) URLs of the sourced public-domain stills, shown as a Ken-Burns
   *  slideshow. Remotion rejects file://, so the renderer serves them. */
  imageSrcs: string[]
  /** HTTP(S) URL of the narration audio bed. */
  audioSrc: string
  /** Total narration length; the composition runs exactly this long. */
  durationSec: number
  /** Timed caption pages with optional per-word stamps for karaoke. */
  cues: CaptionCue[]
  /** Composition frame rate. */
  fps: number
  /** Per-beat stitched timeline (mixed video + Ken-Burns stills). When present
   *  and non-empty it overrides the even imageSrcs slideshow; when empty the
   *  composition renders the imageSrcs slideshow for backward compatibility. */
  beatClips?: BeatClip[]
}

export const DEFAULT_FPS = 30
export const VIDEO_WIDTH = 1080
export const VIDEO_HEIGHT = 1920
