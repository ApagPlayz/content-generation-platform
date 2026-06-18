// Remotion entry point. This file is the `entryPoint` passed to bundle() by
// src/lib/render/remotion.ts. The folder is named `video/` (not `remotion/`)
// on purpose: with baseUrl="." a `remotion/` folder would shadow the npm
// package of the same name. It is excluded from Next's tsconfig — Remotion
// compiles this tree with its own webpack build, independent of the Next app.
import { registerRoot } from 'remotion'
import { RemotionRoot } from './Root'

registerRoot(RemotionRoot)
