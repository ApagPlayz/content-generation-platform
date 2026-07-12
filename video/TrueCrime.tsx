import { useState } from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { CaptionCue, TrueCrimeProps } from './types'

// 9:16 True Crime slideshow: public-domain stills with a slow Ken-Burns drift,
// the narration as the audio bed, and word-by-word (karaoke) captions in the
// lower third. The captions read their per-word timings from `cues[].tokens`
// (supplied by the Kokoro TTS engine); when a page has no token stamps it falls
// back to highlighting the whole page for its window. This is the animated
// alternative to assemble.ts's ffmpeg slideshow + static SRT burn.
export const TrueCrime: React.FC<TrueCrimeProps> = ({
  imageSrcs,
  audioSrc,
  durationSec,
  cues,
  beatClips,
}) => {
  const { fps, durationInFrames } = useVideoConfig()
  const total = durationInFrames || Math.max(1, Math.round(durationSec * fps))

  // Split the runtime evenly across the stills. A tiny overlap (extra frames on
  // each clip) keeps the crossfade from flashing black at the seam.
  const count = Math.max(1, imageSrcs.length)
  const per = Math.ceil(total / count)
  const overlap = Math.round(fps * 0.5)

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {beatClips && beatClips.length > 0 ? (
        // Per-beat stitched timeline: real video clips and Ken-Burns stills cut
        // on the shared beat timeline. Each segment is its own <Sequence>; the
        // single narration <Audio> bed and karaoke captions below are keyed to
        // absolute audio seconds, so cuts never desync the voice.
        beatClips.map((clip, i) =>
          clip.kind === 'video' ? (
            <Sequence
              key={i}
              from={clip.startFrame}
              durationInFrames={clip.durationInFrames}
              layout="none"
            >
              <OffthreadVideo
                src={clip.src}
                // Absolute source-frame window: trim start (inSec) → start+dur.
                // OffthreadVideo clamps trimAfter to the clip's real length, so a
                // clip shorter than its slot holds its last frame instead of erroring.
                trimBefore={Math.max(0, Math.round((clip.inSec ?? 0) * fps))}
                trimAfter={Math.max(
                  Math.round((clip.inSec ?? 0) * fps) + 1,
                  Math.round((clip.inSec ?? 0) * fps) + clip.durationInFrames
                )}
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </Sequence>
          ) : (
            <Sequence
              key={i}
              from={clip.startFrame}
              durationInFrames={clip.durationInFrames}
              layout="none"
            >
              <KenBurns src={clip.src} durationInFrames={clip.durationInFrames} index={i} />
            </Sequence>
          )
        )
      ) : imageSrcs.length > 0 ? (
        imageSrcs.map((src, i) => (
          <Sequence
            key={i}
            from={i * per}
            durationInFrames={per + overlap}
            layout="none"
          >
            <KenBurns src={src} durationInFrames={per + overlap} index={i} />
          </Sequence>
        ))
      ) : (
        <AbsoluteFill style={{ backgroundColor: '#0c0f14' }} />
      )}

      {/* Cinematic darkening so the white captions stay legible over any still. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      <KaraokeCaptions cues={cues} />

      {audioSrc ? <Audio src={audioSrc} /> : null}
    </AbsoluteFill>
  )
}

// A single still with a slow zoom + pan and short fades at both ends. Direction
// alternates per image so the motion doesn't feel mechanical. If Chromium can't
// decode the image (corrupt download etc.), `onError` swaps in a styled gradient
// frame instead of letting <Img> cancel the whole render.
const KenBurns: React.FC<{ src: string; durationInFrames: number; index: number }> = ({
  src,
  durationInFrames,
  index,
}) => {
  const frame = useCurrentFrame()
  const [failed, setFailed] = useState(false)
  const dir = index % 2 === 0 ? 1 : -1

  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1.18], {
    extrapolateRight: 'clamp',
  })
  const translateX = interpolate(frame, [0, durationInFrames], [0, dir * 40], {
    extrapolateRight: 'clamp',
  })
  const fade = Math.round((durationInFrames || 30) * 0.12)
  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  return (
    <AbsoluteFill style={{ opacity }}>
      {failed ? (
        <AbsoluteFill
          style={{
            background:
              index % 2 === 0
                ? 'linear-gradient(160deg, #1c2029 0%, #0c0f14 62%, #05070a 100%)'
                : 'linear-gradient(200deg, #151a22 0%, #0a0d12 58%, #04060a 100%)',
          }}
        />
      ) : (
        <Img
          src={src}
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale}) translateX(${translateX}px)`,
          }}
        />
      )}
    </AbsoluteFill>
  )
}

const KaraokeCaptions: React.FC<{ cues: CaptionCue[] }> = ({ cues }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  const cue =
    cues.find((c) => t >= c.startSec && t < c.endSec) ??
    // After the last cue ends, keep the final page on screen.
    (cues.length && t >= cues[cues.length - 1].endSec ? cues[cues.length - 1] : null)
  if (!cue) return null

  // Prefer real per-word stamps (Kokoro). Without them, split the page's window
  // evenly across its words so the karaoke still sweeps word-by-word instead of
  // flashing the whole page at once.
  const tokens =
    cue.tokens && cue.tokens.length > 0
      ? cue.tokens
      : (() => {
          const ws = cue.text.split(/\s+/).filter(Boolean)
          const span = (cue.endSec - cue.startSec) / Math.max(1, ws.length)
          return ws.map((text, i) => ({
            text,
            startSec: cue.startSec + i * span,
            endSec: cue.startSec + (i + 1) * span,
          }))
        })()

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 72px 360px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          // Per-span margin (not flex `gap`, which renders inconsistently in
          // the headless Chromium) guarantees visible spacing between words.
          rowGap: '10px',
        }}
      >
        {tokens.map((tok, i) => {
          const active = t >= tok.startSec && t < tok.endSec
          const spoken = t >= tok.endSec
          // Active word pops bright amber; already-spoken words stay white;
          // upcoming words sit dimmed so the eye tracks the current word.
          const color = active ? '#ffd54a' : spoken ? '#ffffff' : 'rgba(255,255,255,0.55)'
          return (
            <span
              key={i}
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: 82,
                fontWeight: 900,
                color,
                lineHeight: 1.04,
                letterSpacing: '-0.5px',
                // 16px per side: the 3px text stroke + the active-word scale
                // both bleed into the gap, so 9px read as words glued together.
                margin: '0 16px',
                transform: active ? 'scale(1.06)' : 'scale(1)',
                transition: 'none',
                WebkitTextStroke: '3px #000',
                textShadow: '0 6px 26px rgba(0,0,0,0.9)',
              }}
            >
              {tok.text}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
