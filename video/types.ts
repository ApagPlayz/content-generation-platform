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

export const DEFAULT_FPS = 30
export const VIDEO_WIDTH = 1080
export const VIDEO_HEIGHT = 1920
