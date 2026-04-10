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

      // ── Sync sold items from Depop before relisting ──
      // Check which "active" listings have actually been sold on Depop
      const { depopFetch } = await import('@/lib/depop/client')
      try {
        const meRes = await depopFetch('/users/me/')
        if (meRes.ok) {
          const me = meRes.json() as Record<string, unknown>
          const depopUserId = me.id
          if (depopUserId) {
            const res = await depopFetch(`/users/${depopUserId}/products/?limit=200`)
            if (res.ok) {
              const data = res.json() as Record<string, unknown>
              const products = (data.objects ?? []) as Record<string, unknown>[]
              // Build a map of depop product ID → status
              const statusMap = new Map<string, string>()
              for (const p of products) {
                statusMap.set(String(p.id ?? ''), String(p.status ?? 'S').toUpperCase())
              }
              // Find any "active" listings in our DB that are actually sold on Depop
              const activePlatforms = await prisma.listingPlatform.findMany({
                where: { platform: 'DEPOP', platformStatus: 'active' },
                select: { id: true, platformListingId: true, listingId: true },
              })
              let soldCount = 0
              for (const ap of activePlatforms) {
                const depopStatus = statusMap.get(ap.platformListingId ?? '')
                // If listing exists on Depop and is NOT 'S' (for sale), it's sold
                // If listing doesn't exist in the response at all, it may have been removed/sold
                if (depopStatus && depopStatus !== 'S') {
                  await prisma.listingPlatform.update({
                    where: { id: ap.id },
                    data: { platformStatus: 'sold' },
                  })
                  await prisma.listing.update({
                    where: { id: ap.listingId },
                    data: { status: 'SOLD' },
                  })
                  soldCount++
                }
              }
              if (soldCount > 0) {
                console.log(`[AutoRelist] Synced ${soldCount} sold items from Depop`)
              }
            }
          }
        }
      } catch (err) {
        console.warn('[AutoRelist] Depop sync failed, continuing with cached statuses:', err)
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

      // Filter out listings marked with hold markers
      const relistable = staleListings.filter(entry => {
        const desc = (entry.listing.description ?? '').toLowerCase()
        if (desc.includes('do not buy') || desc.includes('do not purchase') || desc.includes('not for sale')) {
          console.log(`[AutoRelist] Skipping ${entry.listingId} — description contains hold marker`)
          return false
        }
        return true
      })

      let relisted = 0
      for (let i = 0; i < relistable.length; i++) {
        const entry = relistable[i]
        try {
          // Wait 30s between relist attempts to avoid Depop rate-limiting
          if (i > 0) {
            console.log(`[AutoRelist] Waiting 30s before next relist...`)
            await new Promise((r) => setTimeout(r, 30000))
          }
          console.log(`[AutoRelist] Relisting ${entry.listingId} (listedAt: ${entry.listedAt?.toISOString()})`)
          const result = await relistListing(entry.listingId)
          if (result.success) relisted++
        } catch (err) {
          console.error(`[AutoRelist] Failed for ${entry.listingId}:`, err)
        }
      }
      results.push(`autoRelist(${relisted}/${relistable.length})`)
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
