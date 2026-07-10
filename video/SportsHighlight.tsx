import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { SportsHighlightProps } from './types'

// 9:16 vertical highlight: the source reel cropped to fill, with the hook
// revealed word-by-word in the lower third. Replaces the ffmpeg `drawtext`
// burn (a single static white line) with motion the old pipeline couldn't do.
export const SportsHighlight: React.FC<SportsHighlightProps> = ({
  videoSrc,
  startSec,
  endSec,
  hook,
}) => {
  const { fps } = useVideoConfig()

  // trimBefore/trimAfter are absolute frame offsets into the source, measured
  // at the composition fps — i.e. startSec/endSec converted to frames.
  const trimBefore = Math.max(0, Math.round(startSec * fps))
  const trimAfter = Math.max(trimBefore + 1, Math.round(endSec * fps))

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo
        src={videoSrc}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        // Cover the 1080×1920 frame, cropping overflow — same intent as the
        // ffmpeg `crop=ih*9/16:ih,scale=1080:1920` chain.
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <HookCaption text={hook} />
    </AbsoluteFill>
  )
}

const HookCaption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const words = text.split(/\s+/).filter(Boolean)

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 64px 300px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '12px 16px',
        }}
      >
        {words.map((word, i) => {
          // Stagger each word in by a few frames for a kinetic-caption feel.
          const enter = spring({
            frame: frame - i * 3,
            fps,
            config: { damping: 200 },
          })
          const translateY = interpolate(enter, [0, 1], [48, 0])
          const opacity = interpolate(enter, [0, 1], [0, 1])
          return (
            <span
              key={i}
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: 76,
                fontWeight: 800,
                color: '#fff',
                lineHeight: 1.05,
                opacity,
                transform: `translateY(${translateY}px)`,
                WebkitTextStroke: '2px #000',
                textShadow: '0 6px 22px rgba(0,0,0,0.85)',
              }}
            >
              {word}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
