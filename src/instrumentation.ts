// Next.js instrumentation hook — runs once when the server process starts.
// We use it to drive the scheduler IN-PROCESS so the app no longer needs an
// external cron job.
//
// IMPORTANT: Next compiles this file for BOTH the nodejs and edge runtimes. The
// scheduler pulls in node-only code (googleapis, ffmpeg, Remotion), which the
// edge/client compilers cannot bundle. `process.env.NEXT_RUNTIME` is a
// compile-time constant per bundle, so importing the node-only bootstrap ONLY
// inside the `=== 'nodejs'` branch lets the edge compiler dead-code-eliminate
// it. Never import the scheduler / pipeline statically here.

export async function register() {
  // Positive `=== 'nodejs'` guard (not an early return): NEXT_RUNTIME is a
  // compile-time constant, so the edge/client bundles fold this to `if (false)`
  // and drop the import() — and the node-only graph behind it — completely.
  // Also skip `next build`, where register() still fires and its async work can
  // race the build's page-data worker.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startScheduler } = await import('./instrumentation-node')
    await startScheduler()
  }
}
