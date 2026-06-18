import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Remotion's renderer/bundler spawn native binaries (headless Chromium,
  // esbuild) and must never be bundled into Next's server output — keep them
  // as external CommonJS requires resolved at runtime.
  serverExternalPackages: ['@remotion/renderer', '@remotion/bundler'],
}

export default config
