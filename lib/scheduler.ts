/**
 * Internal cron scheduler that runs inside the Next.js server process.
 * Railway keeps the server running 24/7, so this fires even when no one
 * has the app open in a browser.
 *
 * Runs every hour on the hour. Each run checks:
 *   1. Auto-publish: publishes up to N draft listings per day
 *   2. Auto-relist: relists stale active listings older than X days
 *
 * Calls job functions directly (no HTTP) to avoid Docker networking issues.
 */

let started = false

function scheduleNext() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(next.getHours() + 1, 0, 0, 0)
  const delay = next.getTime() - now.getTime()

  setTimeout(async () => {
    await runJobs()
    scheduleNext()
  }, delay)

  console.log(`[Scheduler] Next run at ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`)
}

async function runJobs() {
  try {
    console.log('[Scheduler] Running auto-publish + auto-relist jobs...')

    // Import lazily to avoid circular deps at startup
    const { prisma } = await import('@/lib/db/client')
    const { publishListing, relistListing } = await import('@/lib/listings/publish')

    const results: string[] = []

    // ── Auto-publish: publish N oldest DRAFT listings per day ──
    const publishSetting = await prisma.appSettings.findUnique({ where: { key: 'autoPublishPerDay' } })
    const dailyPublishLimit = parseInt(publishSetting?.value ?? '0', 10)

    if (dailyPublishLimit > 0) {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const publishedToday = await prisma.listingPlatform.count({
        where: { listedAt: { gte: todayStart } },
      })

      const remaining = Math.max(0, dailyPublishLimit - publishedToday)

      if (remaining > 0) {
        const drafts = await prisma.listing.findMany({
          where: { status: 'DRAFT' },
          orderBy: { createdAt: 'asc' },
          take: remaining,
        })

        let published = 0
        for (const draft of drafts) {
          try {
            const result = await publishListing(draft.id, ['DEPOP'])
            if (Object.values(result).some((r) => r.success)) published++
          } catch (err) {
            console.error(`[AutoPublish] Failed for ${draft.id}:`, err)
          }
        }
        results.push(`autoPublish(${published}/${drafts.length})`)
      } else {
        results.push(`autoPublish(daily limit reached: ${publishedToday}/${dailyPublishLimit})`)
      }
    }

    // ── Auto-relist: relist ACTIVE listings older than X days ──
    const [afterDaysSetting, perDaySetting] = await Promise.all([
      prisma.appSettings.findUnique({ where: { key: 'autoRelistAfterDays' } }),
      prisma.appSettings.findUnique({ where: { key: 'autoRelistPerDay' } }),
    ])
    const afterDays = parseInt(afterDaysSetting?.value ?? '0', 10)
    const perDay = parseInt(perDaySetting?.value ?? '0', 10)

    if (afterDays > 0 && perDay > 0) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - afterDays)
      console.log(`[AutoRelist] Config: afterDays=${afterDays}, perDay=${perDay}, cutoff=${cutoff.toISOString()}`)

      // Normalize any legacy Depop status codes to human-readable values
      const migratedActive = await prisma.listingPlatform.updateMany({
        where: { platform: 'DEPOP', platformStatus: { in: ['S', 's'] } },
        data: { platformStatus: 'active' },
      })
      const migratedSold = await prisma.listingPlatform.updateMany({
        where: { platform: 'DEPOP', platformStatus: { in: ['P', 'M', 'p', 'm'] } },
        data: { platformStatus: 'sold' },
      })
      if (migratedActive.count > 0 || migratedSold.count > 0) {
        console.log(`[AutoRelist] Migrated platformStatus: ${migratedActive.count} → 'active', ${migratedSold.count} → 'sold'`)
      }

      const staleListings = await prisma.listingPlatform.findMany({
        where: {
          platform: 'DEPOP',
          platformStatus: 'active',
          listedAt: { lt: cutoff },
          listing: { status: 'ACTIVE' },
        },
        include: { listing: true },
        orderBy: { listedAt: 'asc' },
        take: perDay,
      })

      console.log(`[AutoRelist] Found ${staleListings.length} stale listings to relist`)

      let relisted = 0
      for (const entry of staleListings) {
        try {
          console.log(`[AutoRelist] Relisting ${entry.listingId} (listedAt: ${entry.listedAt?.toISOString()})`)
          const result = await relistListing(entry.listingId)
          if (result.success) relisted++
        } catch (err) {
          console.error(`[AutoRelist] Failed for ${entry.listingId}:`, err)
        }
      }
      results.push(`autoRelist(${relisted}/${staleListings.length})`)
    }

    console.log('[Scheduler] Done:', results.join(', ') || 'no jobs configured')
  } catch (err) {
    console.error('[Scheduler] Job run failed:', err)
  }
}

export function startScheduler() {
  if (started) return
  started = true

  console.log('[Scheduler] Starting internal cron scheduler (runs every hour)')

  // Run once 60s after startup
  setTimeout(() => runJobs(), 60000)

  // Then schedule hourly
  scheduleNext()
}
