import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { createEbayListing } from '@/lib/ebay/listings'
import { createDepopListing } from '@/lib/depop/listings'

// Browser automation can take up to 90s
export const maxDuration = 90

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { platforms } = await req.json() as { platforms: ('EBAY' | 'DEPOP')[] }

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { platforms: true },
  })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const results: Record<string, { success: boolean; url?: string; error?: string }> = {}

  for (const platform of platforms) {
    try {
      let platformListingId: string
      let platformUrl: string

      if (platform === 'EBAY') {
        const result = await createEbayListing(listing as Parameters<typeof createEbayListing>[0])
        platformListingId = result.listingId
        platformUrl = result.url
      } else {
        const result = await createDepopListing(listing as Parameters<typeof createDepopListing>[0])
        platformListingId = result.listingId
        platformUrl = result.url
      }

      await prisma.listingPlatform.upsert({
        where: { listingId_platform: { listingId: id, platform } },
        create: {
          listingId: id,
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
      results[platform] = { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Update listing status to ACTIVE if any platform succeeded
  const anySuccess = Object.values(results).some((r) => r.success)
  if (anySuccess) {
    await prisma.listing.update({ where: { id }, data: { status: 'ACTIVE' } })
  }

  return NextResponse.json({ results })
}
