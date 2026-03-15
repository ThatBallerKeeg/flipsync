import { prisma } from '@/lib/db/client'
import { createDepopListing } from '@/lib/depop/listings'
import { createEbayListing } from '@/lib/ebay/listings'

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
