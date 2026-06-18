import { Composition } from 'remotion'
import { SportsHighlight } from './SportsHighlight'
import {
  DEFAULT_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type SportsHighlightProps,
} from './types'

// Single composition for the F9 sports factory. Duration is derived from the
// moment window via calculateMetadata so each render is exactly the clip
// length — the server passes startSec/endSec/fps as input props.
export const RemotionRoot: React.FC = () => {
  return (
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
  )
}
