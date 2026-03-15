import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { publishListing, relistListing } from '@/lib/listings/publish'

// Auto-publish can take a while with Playwright
export const maxDuration = 300

// Called by cron (Vercel Cron or system cron) to run background jobs.
// Protected by a shared secret in production.
export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-secret')
  if (auth !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { job } = await req.json().catch(() => ({ job: 'all' }))
  const enqueued: string[] = []

  try {
    // Existing queue-based jobs (analytics, tokens)
    if (job === 'analytics' || job === 'tokens' || job === 'all') {
      try {
        const { analyticsQueue, tokenQueue } = await import('@/jobs/queue')

        if (job === 'analytics' || job === 'all') {
          await analyticsQueue.add('syncAnalytics', {}, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
          enqueued.push('syncAnalytics')
        }

        if (job === 'tokens' || job === 'all') {
          await tokenQueue.add('refreshTokens', {}, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
          enqueued.push('refreshTokens')
        }
      } catch (err) {
        console.warn('Queue jobs skipped (Redis may be unavailable):', err)
      }
    }

    // Auto-publish: publish N oldest DRAFT listings per day
    if (job === 'autoPublish' || job === 'all') {
      const setting = await prisma.appSettings.findUnique({
        where: { key: 'autoPublishPerDay' },
      })
      const dailyLimit = parseInt(setting?.value ?? '0', 10)

      if (dailyLimit > 0) {
        // Check how many we've already published today to avoid over-publishing
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)

        const publishedToday = await prisma.listingPlatform.count({
          where: {
            listedAt: { gte: todayStart },
          },
        })

        const remaining = Math.max(0, dailyLimit - publishedToday)

        if (remaining > 0) {
          const drafts = await prisma.listing.findMany({
            where: { status: 'DRAFT' },
            orderBy: { createdAt: 'asc' },
            take: remaining,
          })

          const results: { id: string; success: boolean; error?: string }[] = []

          for (const draft of drafts) {
            try {
              const result = await publishListing(draft.id, ['DEPOP'])
              const success = Object.values(result).some((r) => r.success)
              results.push({
                id: draft.id,
                success,
                error: success ? undefined : Object.values(result).map((r) => r.error).join(', '),
              })
            } catch (err) {
              results.push({
                id: draft.id,
                success: false,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          const successCount = results.filter((r) => r.success).length
          enqueued.push(`autoPublish(${successCount}/${drafts.length})`)
          console.log('[AutoPublish] Results:', JSON.stringify(results))
        } else {
          enqueued.push(`autoPublish(already at daily limit: ${publishedToday}/${dailyLimit})`)
        }
      }
    }

    // Auto-relist: relist ACTIVE listings older than X days
    if (job === 'autoRelist' || job === 'all') {
      const [afterDaysSetting, perDaySetting] = await Promise.all([
        prisma.appSettings.findUnique({ where: { key: 'autoRelistAfterDays' } }),
        prisma.appSettings.findUnique({ where: { key: 'autoRelistPerDay' } }),
      ])
      const afterDays = parseInt(afterDaysSetting?.value ?? '0', 10)
      const perDay = parseInt(perDaySetting?.value ?? '0', 10)

      if (afterDays > 0 && perDay > 0) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - afterDays)

        // Find ACTIVE listings with Depop platform where listedAt is older than cutoff
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

        const results: { id: string; success: boolean; error?: string }[] = []

        for (const platformEntry of staleListings) {
          try {
            const result = await relistListing(platformEntry.listingId)
            results.push({ id: platformEntry.listingId, success: result.success })
          } catch (err) {
            results.push({
              id: platformEntry.listingId,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        const successCount = results.filter((r) => r.success).length
        enqueued.push(`autoRelist(${successCount}/${staleListings.length})`)
        console.log('[AutoRelist] Results:', JSON.stringify(results))
      }
    }

    return NextResponse.json({ enqueued })
  } catch (err) {
    console.error('Job run error:', err)
    return NextResponse.json({ error: 'Failed to run jobs' }, { status: 500 })
  }
}
