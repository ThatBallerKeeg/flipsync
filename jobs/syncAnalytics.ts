import { Worker } from 'bullmq'
import { connection } from './queue'
import { prisma } from '@/lib/db/client'
import { getEbayTrafficReport } from '@/lib/ebay/analytics'

export const syncAnalyticsWorker = new Worker(
  'syncAnalytics',
  async () => {
    const activeListings = await prisma.listing.findMany({
      where: { status: 'ACTIVE' },
      include: { platforms: true },
    })

    const ebayListingIds = activeListings
      .flatMap((l) => l.platforms)
      .filter((p) => p.platform === 'EBAY' && p.platformListingId)
      .map((p) => p.platformListingId!)

    let ebayTraffic: Record<string, { views: number; clicks: number }> = {}
    if (ebayListingIds.length) {
      try {
        ebayTraffic = await getEbayTrafficReport(ebayListingIds)
      } catch {
        // eBay analytics may not be connected
      }
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const listing of activeListings) {
      for (const platform of listing.platforms) {
        const analyticsData =
          platform.platform === 'EBAY' && platform.platformListingId
            ? ebayTraffic[platform.platformListingId]
            : null

        await prisma.listingAnalytics.upsert({
          where: {
            listingId_platform_date: {
              listingId: listing.id,
              platform: platform.platform,
              date: today,
            },
          },
          create: {
            listingId: listing.id,
            platform: platform.platform,
            date: today,
            views: analyticsData?.views ?? 0,
            clicks: analyticsData?.clicks ?? 0,
          },
          update: {
            views: analyticsData?.views ?? 0,
            clicks: analyticsData?.clicks ?? 0,
          },
        })
      }
    }
  },
  { connection }
)
