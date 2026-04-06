import { prisma } from '@/lib/db/client'
import { createDepopListing } from '@/lib/depop/listings'
import { createEbayListing } from '@/lib/ebay/listings'
import { depopFetch } from '@/lib/depop/client'
import { rewriteListingDescription } from '@/lib/claude/rewrite'
import https from 'https'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

export type PublishResult = Record<
  string,
  { success: boolean; url?: string; error?: string }
>

/**
 * Publish a listing to one or more platforms.
 * Used by both the publish API route and the auto-publish cron job.
 */
export async function publishListing(
  listingId: string,
  platforms: ('DEPOP' | 'EBAY')[]
): Promise<PublishResult> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { platforms: true },
  })
  if (!listing) throw new Error('Listing not found')

  const results: PublishResult = {}

  for (const platform of platforms) {
    try {
      let platformListingId: string
      let platformUrl: string

      if (platform === 'EBAY') {
        const result = await createEbayListing(
          listing as Parameters<typeof createEbayListing>[0]
        )
        platformListingId = result.listingId
        platformUrl = result.url
      } else {
        const result = await createDepopListing(
          listing as Parameters<typeof createDepopListing>[0]
        )
        platformListingId = result.listingId
        platformUrl = result.url
      }

      await prisma.listingPlatform.upsert({
        where: {
          listingId_platform: { listingId: listingId, platform },
        },
        create: {
          listingId: listingId,
          platform,
          platformListingId,
          platformUrl,
          platformStatus: 'active',
          listedAt: new Date(),
        },
        update: {
          platformListingId,
          platformUrl,
          platformStatus: 'active',
          listedAt: new Date(),
        },
      })

      results[platform] = { success: true, url: platformUrl }
    } catch (err) {
      results[platform] = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Update listing status to ACTIVE if any platform succeeded
  const anySuccess = Object.values(results).some((r) => r.success)
  if (anySuccess) {
    await prisma.listing.update({
      where: { id: listingId },
      data: { status: 'ACTIVE' },
    })
  }

  return results
}

/**
 * Relist a listing on Depop: delete the old one and create an identical new one.
 * This bumps the listing to the top of search results.
 */
export async function relistListing(
  listingId: string
): Promise<{ success: boolean; newUrl?: string; error?: string }> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { platforms: true },
  })
  if (!listing) throw new Error('Listing not found')

  const depopPlatform = listing.platforms.find((p) => p.platform === 'DEPOP')
  if (!depopPlatform?.platformListingId) {
    throw new Error('Listing is not published on Depop')
  }

  // 1. Download photos BEFORE deleting the old listing.
  //    Synced listings store Depop CDN URLs which become invalid after deletion.
  const tempPhotos: string[] = []
  try {
    for (const photoUrl of listing.photos.slice(0, 4)) {
      if (!photoUrl.startsWith('http')) continue
      const ext = photoUrl.split('.').pop()?.split('?')[0] ?? 'jpg'
      const tmpPath = path.join(os.tmpdir(), `relist-photo-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
      await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(tmpPath)
        const client = photoUrl.startsWith('https://') ? https : http
        client.get(photoUrl, (res) => {
          res.pipe(file)
          file.on('finish', () => { file.close(); resolve() })
        }).on('error', reject)
      })
      tempPhotos.push(tmpPath)
    }
    console.log(`[Relist] Pre-downloaded ${tempPhotos.length} photos to temp files`)
  } catch (err) {
    console.warn(`[Relist] Photo pre-download failed:`, err)
  }

  // 2. Delete old listing from Depop
  try {
    const delResp = await depopFetch(`/products/${depopPlatform.platformListingId}/`, {
      method: 'DELETE',
    })
    if (delResp.ok) {
      console.log(`[Relist] Deleted old Depop listing: ${depopPlatform.platformListingId}`)
    } else {
      console.warn(`[Relist] DELETE returned ${delResp.status} for ${depopPlatform.platformListingId} — old listing may still be active`)
    }
  } catch (err) {
    console.warn(`[Relist] Failed to delete old listing (may already be gone):`, err)
  }

  // 3. Rewrite description for freshness (varied wording, shuffled tags)
  let rewrittenDesc = listing.description
  try {
    rewrittenDesc = await rewriteListingDescription(listing.description ?? '', listing.title ?? '')
    console.log(`[Relist] Description rewritten (${rewrittenDesc.length} chars)`)
  } catch (err) {
    console.warn('[Relist] Description rewrite failed, using original:', err)
  }

  // 4. Create new listing via Playwright using pre-downloaded photos
  const listingWithLocalPhotos = {
    ...listing,
    description: rewrittenDesc,
    photos: tempPhotos.length > 0 ? tempPhotos : listing.photos,
  }

  try {
    const result = await createDepopListing(
      listingWithLocalPhotos as Parameters<typeof createDepopListing>[0]
    )

    // 5. Update ListingPlatform with new IDs and fresh listedAt
    await prisma.listingPlatform.update({
      where: { id: depopPlatform.id },
      data: {
        platformListingId: result.listingId,
        platformUrl: result.url,
        platformStatus: 'active',
        listedAt: new Date(),
      },
    })

    console.log(`[Relist] New Depop listing created: ${result.url}`)
    return { success: true, newUrl: result.url }
  } finally {
    // Clean up temp files
    for (const f of tempPhotos) {
      fs.unlink(f, () => {})
    }
  }
}
