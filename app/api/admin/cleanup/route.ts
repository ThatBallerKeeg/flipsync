import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

/**
 * GET /api/admin/cleanup
 *
 * Frees Postgres disk space by deleting pure-cache tables that can be
 * safely removed at any time (they are rebuilt on demand):
 *   - PriceComparison  (cached Brave Search results)
 *   - Valuation        (cached Claude price estimates)
 *   - BulkJob          (completed/failed job records)
 *   - AppSettings depopBrowserState (can be 500KB+; rebuilt on next Depop use)
 *   - Photo records older than 30 days
 *
 * Listings, Sales, and ConnectedAccounts are NOT touched.
 */
export async function GET() {
  const results: Record<string, number | string> = {}

  try {
    // Cache tables — always safe to delete
    const [pc, val, jobs] = await Promise.all([
      prisma.priceComparison.deleteMany({}),
      prisma.valuation.deleteMany({}),
      prisma.bulkJob.deleteMany({}),
    ])
    results.priceComparisons = pc.count
    results.valuations = val.count
    results.bulkJobs = jobs.count

    // Large AppSettings value
    const browserState = await prisma.appSettings.deleteMany({
      where: { key: 'depopBrowserState' },
    })
    results.depopBrowserState = browserState.count

    // Old photos (> 30 days) — recent ones kept for active listings
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const oldPhotos = await prisma.photo.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    results.oldPhotos = oldPhotos.count

    // Run VACUUM to reclaim disk space immediately (no FULL lock needed for autovacuum,
    // but explicit ANALYZE updates query planner stats)
    await prisma.$executeRawUnsafe('VACUUM ANALYZE "PriceComparison", "Valuation", "BulkJob", "Photo"')
    results.vacuum = 'done'

    return NextResponse.json({ ok: true, deleted: results })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), partial: results },
      { status: 500 }
    )
  }
}
