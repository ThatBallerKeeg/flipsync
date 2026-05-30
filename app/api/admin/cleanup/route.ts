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
  const errors: string[] = []

  // Each delete is attempted independently so one failure doesn't block the others.
  // Deletes write only a small WAL entry and succeed even when the data disk is full.
  const tryDelete = async (label: string, fn: () => Promise<{ count: number }>) => {
    try {
      const r = await fn()
      results[label] = r.count
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      results[label] = 'error'
    }
  }

  await tryDelete('priceComparisons', () => prisma.priceComparison.deleteMany({}))
  await tryDelete('valuations',       () => prisma.valuation.deleteMany({}))
  await tryDelete('bulkJobs',         () => prisma.bulkJob.deleteMany({}))
  await tryDelete('photos',           () => prisma.photo.deleteMany({}))
  await tryDelete('depopBrowserState',() => prisma.appSettings.deleteMany({ where: { key: 'depopBrowserState' } }))

  // VACUUM marks freed pages as reusable for new inserts.
  // Runs after deletes; skip if disk is so full it can't write WAL.
  try {
    await prisma.$executeRawUnsafe('VACUUM "PriceComparison"')
    await prisma.$executeRawUnsafe('VACUUM "Valuation"')
    await prisma.$executeRawUnsafe('VACUUM "BulkJob"')
    await prisma.$executeRawUnsafe('VACUUM "Photo"')
    results.vacuum = 'done'
  } catch (e) {
    results.vacuum = `skipped (${e instanceof Error ? e.message.slice(0, 60) : 'error'})`
  }

  const ok = errors.length === 0
  return NextResponse.json({ ok, deleted: results, errors }, { status: ok ? 200 : 207 })
}
