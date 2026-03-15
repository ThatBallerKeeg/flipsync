/**
 * Internal cron scheduler that runs inside the Next.js server process.
 * Railway keeps the server running 24/7, so this fires even when no one
 * has the app open in a browser.
 *
 * Runs every hour on the hour. Each run checks:
 *   1. Auto-publish: publishes up to N draft listings per day
 *   2. Auto-relist: relists stale active listings older than X days
 */

let started = false

function scheduleNext() {
  // Calculate ms until the next full hour
  const now = new Date()
  const next = new Date(now)
  next.setHours(next.getHours() + 1, 0, 0, 0)
  const delay = next.getTime() - now.getTime()

  setTimeout(async () => {
    await runJobs()
    scheduleNext() // schedule the next tick
  }, delay)

  console.log(`[Scheduler] Next run at ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`)
}

async function runJobs() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `http://localhost:${process.env.PORT || 3000}`

  try {
    console.log('[Scheduler] Running auto-publish + auto-relist jobs...')
    const res = await fetch(`${baseUrl}/api/jobs/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || '__internal__',
      },
      body: JSON.stringify({ job: 'all' }),
    })
    const data = await res.json()
    console.log('[Scheduler] Job results:', JSON.stringify(data))
  } catch (err) {
    console.error('[Scheduler] Job run failed:', err)
  }
}

/**
 * Start the internal scheduler. Safe to call multiple times — only starts once.
 */
export function startScheduler() {
  if (started) return
  started = true

  console.log('[Scheduler] Starting internal cron scheduler (runs every hour)')

  // Run once on startup (after a 30s delay to let the server fully boot)
  setTimeout(() => {
    runJobs()
  }, 30000)

  // Then schedule hourly runs
  scheduleNext()
}
