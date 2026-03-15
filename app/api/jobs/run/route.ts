import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { publishListing } from '@/lib/listings/publish'

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

    return NextResponse.json({ enqueued })
  } catch (err) {
    console.error('Job run error:', err)
    return NextResponse.json({ error: 'Failed to run jobs' }, { status: 500 })
  }
}
