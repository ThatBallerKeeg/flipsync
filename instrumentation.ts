/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * We use this to start the internal cron scheduler so that
 * auto-publish and auto-relist jobs run hourly on Railway
 * even when no one has the app open.
 */
export async function register() {
  // Only run on the server (not during build or in the browser)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('./lib/scheduler')
    startScheduler()
  }
}
