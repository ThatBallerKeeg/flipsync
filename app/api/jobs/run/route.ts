import { NextRequest, NextResponse } from 'next/server'

// Called by cron (Vercel Cron or system cron) to enqueue background jobs.
// Protected by a shared secret in production.
export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-cron-secret')
  if (auth !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { job } = await req.json().catch(() => ({ job: 'all' }))

  try {
    const { analyticsQueue, tokenQueue } = await import('@/jobs/queue')
    const enqueued: string[] = []

    if (job === 'analytics' || job === 'all') {
      await analyticsQueue.add('syncAnalytics', {}, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      enqueued.push('syncAnalytics')
    }

    if (job === 'tokens' || job === 'all') {
      await tokenQueue.add('refreshTokens', {}, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
      enqueued.push('refreshTokens')
    }

    return NextResponse.json({ enqueued })
  } catch (err) {
    console.error('Job enqueue error:', err)
    return NextResponse.json({ error: 'Failed to enqueue jobs' }, { status: 500 })
  }
}
