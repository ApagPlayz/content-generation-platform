import { Composition } from 'remotion'
import { SportsHighlight } from './SportsHighlight'
import { TrueCrime } from './TrueCrime'
import {
  DEFAULT_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type SportsHighlightProps,
  type TrueCrimeProps,
} from './types'

// Compositions for the local factories. Each derives its exact duration via
// calculateMetadata from props the server passes verbatim, so every render is
// the precise clip / narration length.
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* F9 sports: a moment-window highlight with an animated hook caption. */}
      <Composition<Record<string, unknown>, SportsHighlightProps>
        id="SportsHighlight"
        component={SportsHighlight}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={DEFAULT_FPS * 10}
        defaultProps={{
          videoSrc: '',
          startSec: 0,
          endSec: 10,
          hook: 'The moment everyone is talking about',
          fps: DEFAULT_FPS,
        }}
        calculateMetadata={({ props }) => {
          const fps = props.fps || DEFAULT_FPS
          const windowSec = Math.max(0.5, props.endSec - props.startSec)
          return {
            durationInFrames: Math.max(1, Math.round(windowSec * fps)),
            fps,
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
          }
        }}
      />

      {/* F10 true crime: Ken-Burns slideshow with word-by-word karaoke captions. */}
      <Composition<Record<string, unknown>, TrueCrimeProps>
        id="TrueCrime"
        component={TrueCrime}
        width={VIDEO_WIDTH}
        height={VIDEO_HEIGHT}
        fps={DEFAULT_FPS}
        durationInFrames={DEFAULT_FPS * 60}
        defaultProps={{
          imageSrcs: [],
          audioSrc: '',
          durationSec: 60,
          cues: [],
          fps: DEFAULT_FPS,
          beatClips: [],
        }}
        calculateMetadata={({ props }) => {
          const fps = props.fps || DEFAULT_FPS
          return {
            durationInFrames: Math.max(1, Math.round(props.durationSec * fps)),
            fps,
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT,
          }
        }}
      />
    </>
  )
}
