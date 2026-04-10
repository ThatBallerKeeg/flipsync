/**
 * POST /api/platforms/depop/sync
 *
 * Fetches the authenticated user's Depop listings and upserts them into the
 * local database.
 *
 * Correct endpoint: GET /api/v1/users/{numericId}/products/?limit=200
 * (NOT /products/?userId=... which returns a marketplace feed, not the user's own items)
 *
 * NOTE: Depop's cursor-based pagination loops when limit < total active listings.
 * Using limit=200 fetches all in one shot (meta.end=true). We also deduplicate
 * by tracking seen product IDs to guard against any future loops.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { depopFetch } from '@/lib/depop/client'

export const maxDuration = 120

export async function POST() {
  // Step 1: get numeric user ID
  const meRes = await depopFetch('/users/me/')
  if (!meRes.ok) {
    return NextResponse.json({ error: 'Depop not connected' }, { status: 401 })
  }
  const me = meRes.json() as Record<string, unknown>
  const userId = me.id
  if (!userId) {
    return NextResponse.json({ error: 'Could not get Depop user ID' }, { status: 500 })
  }

  let synced = 0
  let cursor: string | null = null
  const limit = 200 // fetch all in one shot (Depop cursor pagination loops with smaller limits)
  const MAX_PAGES = 5 // safety guard
  const seenIds = new Set<string>() // deduplication across pages

  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = cursor
      ? `?limit=${limit}&last_offset_id=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`

    // Correct path: /users/{numericId}/products/
    const res = await depopFetch(`/users/${userId}/products/${qs}`)
    if (!res.ok) break

    const data = res.json() as Record<string, unknown>
    const objects = (data.objects ?? []) as Record<string, unknown>[]
    if (!objects.length) break

    // Deduplicate: skip any IDs we've already processed
    const newObjects = objects.filter((p) => {
      const id = String(p.id ?? '')
      if (seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })

    if (newObjects.length === 0) break // pagination loop detected — stop

    // Batch: collect all depopIds to find existing records in one query
    const depopIds = newObjects.map((p) => String(p.id ?? ''))
    const existingPlatforms = await prisma.listingPlatform.findMany({
      where: { platform: 'DEPOP', platformListingId: { in: depopIds } },
    })
    const existingMap = new Map(existingPlatforms.map((ep) => [ep.platformListingId!, ep]))

    for (const product of newObjects) {
      try {
        const depopId = String(product.id ?? '')
        const slug = String(product.slug ?? depopId)
        const description = String(product.description ?? '')
        const title = description.split('\n')[0].slice(0, 80).trim() || `Depop item ${depopId}`
        const price = parseFloat(String(product.price_amount ?? '0')) || 0

        // Photos
        const picturesData = (product.pictures_data ?? []) as Record<string, unknown>[]
        const photos = picturesData
          .map((p) => {
            const formats = p.formats as Record<string, { url: string }> | undefined
            return formats?.P0?.url ?? formats?.P2?.url ?? ''
          })
          .filter(Boolean)
          .slice(0, 8)

        // Size & Category
        const size = product.size ? String(product.size) : undefined
        // Extract category from Depop's categories array (e.g. [{ id: 5, name: "T-shirts" }])
        const categories = (product.categories ?? []) as { id?: number; name?: string }[]
        const category = categories.map((c) => c.name).filter(Boolean).join(' > ') || undefined
        // Also extract condition
        const condition = product.condition ? String(product.condition).toLowerCase() : undefined
        const platformUrl = `https://www.depop.com/products/${slug}/`
        const existing = existingMap.get(depopId)

        // Map Depop status field → FlipSync ListingStatus
        // "S" = for Sale, "P" = Pending/sold, "M" = Marked as sold
        const rawDepopStatus = String(product.status ?? 'S').toUpperCase()
        const listingStatus = rawDepopStatus === 'S' ? 'ACTIVE' : 'SOLD'
        // Normalize platformStatus to 'active'/'sold' for consistent querying
        const depopStatus = rawDepopStatus === 'S' ? 'active' : 'sold'

        // Depop API fields: created_date = original creation, pub_date = last publish.
        // Use created_date for listing age (when it was first posted).
        const depopDate = product.created_date ?? product.pub_date
        const listedAt = depopDate ? new Date(String(depopDate)) : null

        if (existing) {
          await prisma.listing.update({
            where: { id: existing.listingId },
            data: { title, description, depopDescription: description, price, photos, status: listingStatus, ...(size && { size }), ...(category && { category }), ...(condition && { condition }) },
          })
          await prisma.listingPlatform.update({
            where: { id: existing.id },
            data: {
              platformUrl,
              platformStatus: depopStatus,
              syncedAt: new Date(),
              // Always update listedAt from Depop's date if available
              ...(listedAt && { listedAt }),
            },
          })
        } else {
          const listing = await prisma.listing.create({
            data: { title, description, depopDescription: description, price, photos, tags: [], status: listingStatus, ...(size && { size }), ...(category && { category }), ...(condition && { condition }) },
          })
          await prisma.listingPlatform.create({
            data: { listingId: listing.id, platform: 'DEPOP', platformListingId: depopId, platformUrl, platformStatus: depopStatus, syncedAt: new Date(), listedAt: listedAt ?? new Date() },
          })
        }
        synced++
      } catch (err) {
        console.error('[Depop sync] Failed to upsert:', product.id, err)
      }
    }

    // Advance cursor or stop
    const meta = data.meta as Record<string, unknown> | undefined
    if (meta?.end || !meta?.last_offset_id || objects.length < limit) break
    cursor = String(meta.last_offset_id)
  }

  // Mark listings that exist in FlipSync but NOT on Depop as ended.
  // These are items that were sold, deleted, or removed from the shop.
  const allDepopIds = Array.from(seenIds)
  const orphanedPlatforms = await prisma.listingPlatform.findMany({
    where: {
      platform: 'DEPOP',
      platformStatus: 'active',
      ...(allDepopIds.length > 0
        ? { platformListingId: { notIn: allDepopIds } }
        : {}),
    },
    select: { id: true, listingId: true, platformListingId: true },
  })

  let removed = 0
  for (const orphan of orphanedPlatforms) {
    try {
      await prisma.listingPlatform.update({
        where: { id: orphan.id },
        data: { platformStatus: 'sold' },
      })
      await prisma.listing.update({
        where: { id: orphan.listingId },
        data: { status: 'SOLD' },
      })
      removed++
    } catch { /* listing may already be updated */ }
  }

  if (removed > 0) {
    console.log(`[Depop sync] Marked ${removed} orphaned listings as sold (not found on Depop)`)
  }

  return NextResponse.json({ synced, removed })
}
