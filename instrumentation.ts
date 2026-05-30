/**
 * Next.js instrumentation hook — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // ── 1. Log which database we're connecting to (host only, no credentials) ──
  const dbUrl = process.env.DATABASE_URL ?? ''
  const dbHost = dbUrl.split('@')[1]?.split('/')[0] ?? '(not set)'
  console.log('[startup] DATABASE_URL host:', dbHost)

  // ── 2. Run pending migrations at startup ─────────────────────────────────
  // Belt-and-suspenders: Dockerfile CMD also runs migrate deploy, but if that
  // fails silently this catches it and logs the real error.
  try {
    const { execSync } = await import('child_process')
    console.log('[startup] Running prisma migrate deploy…')
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env },
    })
    console.log('[startup] Migrations OK')
  } catch (e) {
    console.error('[startup] prisma migrate deploy FAILED:', e)
    // Don't crash the server — app may still work if tables already exist
  }

  // ── 3. Start the cron scheduler ───────────────────────────────────────────
  const { startScheduler } = await import('./lib/scheduler')
  startScheduler()
}
