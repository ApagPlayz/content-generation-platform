import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Remotion's renderer/bundler spawn native binaries (headless Chromium,
  // esbuild) and must never be bundled into Next's server output — keep them
  // as external CommonJS requires resolved at runtime. (Applies to the nodejs
  // server compiler only.)
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler'],
  webpack: (config, { nextRuntime }) => {
    // The render path is reachable (via the pipeline's dynamic import) from the
    // module graph Next compiles for the CLIENT and EDGE runtimes too — and
    // serverExternalPackages only covers the nodejs server. @remotion/bundler
    // statically pulls @rspack's native .node binary, which those compilers
    // can't process ("Node.js binary module … not supported in the browser").
    // The render path only ever executes in the nodejs runtime behind the
    // RENDER_ENGINE=remotion flag, so externalize these everywhere else so the
    // non-node compilers never try to parse the native binary.
    if (nextRuntime !== 'nodejs') {
      const externals = {
        '@remotion/bundler': 'commonjs @remotion/bundler',
        '@remotion/renderer': 'commonjs @remotion/renderer',
      }
      if (Array.isArray(config.externals)) config.externals.push(externals)
      else config.externals = [config.externals, externals].filter(Boolean)
    }
    return config
  },
}

export default config
