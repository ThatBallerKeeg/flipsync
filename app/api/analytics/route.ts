import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { AnalyticsData } from '@/types'

export async function GET() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  // All sales with their listing for days-to-sell calculation
  const sales = await prisma.sale.findMany({
    include: { listing: { select: { title: true, photos: true, createdAt: true } } },
  })

  // Fallback: if no Sale records exist, derive revenue from SOLD listings
  const soldListings = await prisma.listing.findMany({
    where: { status: 'SOLD' },
    select: { id: true, price: true, createdAt: true, updatedAt: true, platforms: { select: { platform: true } } },
  })
  const hasSaleRecords = sales.length > 0

  let totalRevenue = 0
  if (hasSaleRecords) {
    for (const sale of sales) totalRevenue += sale.salePrice
  } else {
    for (const listing of soldListings) totalRevenue += listing.price
  }

  // Last 30 days
  let itemsSold30d: number
  let recentRevenue = 0
  if (hasSaleRecords) {
    const recentSales = sales.filter((s) => s.soldAt >= thirtyDaysAgo)
    itemsSold30d = recentSales.length
    for (const sale of recentSales) recentRevenue += sale.salePrice
  } else {
    // Use updatedAt as approximate sold date for listings without Sale records
    const recentSold = soldListings.filter((l) => l.updatedAt >= thirtyDaysAgo)
    itemsSold30d = recentSold.length
    for (const listing of recentSold) recentRevenue += listing.price
  }
  const avgSalePrice30d = itemsSold30d ? recentRevenue / itemsSold30d : 0

  // Listing counts (total + per-platform active counts for sell-through)
  const [activeCount, soldCount, draftCount, totalCount] = await Promise.all([
    prisma.listing.count({ where: { status: 'ACTIVE' } }),
    prisma.listing.count({ where: { status: 'SOLD' } }),
    prisma.listing.count({ where: { status: 'DRAFT' } }),
    prisma.listing.count(),
  ])
  const sellThroughRate = activeCount + soldCount > 0 ? soldCount / (activeCount + soldCount) : 0

  // Per-platform counts for platform-specific sell-through
  const [ebayActiveCount, depopActiveCount, ebaySoldCount, depopSoldCount] = await Promise.all([
    prisma.listingPlatform.count({
      where: { platform: 'EBAY', listing: { status: 'ACTIVE' } },
    }),
    prisma.listingPlatform.count({
      where: { platform: 'DEPOP', listing: { status: 'ACTIVE' } },
    }),
    prisma.listingPlatform.count({
      where: { platform: 'EBAY', listing: { status: 'SOLD' } },
    }),
    prisma.listingPlatform.count({
      where: { platform: 'DEPOP', listing: { status: 'SOLD' } },
    }),
  ])

  // Revenue by week (last 90 days)
  const weekMap = new Map<string, { ebay: number; depop: number }>()
  if (hasSaleRecords) {
    const recentAllSales = sales.filter((s) => s.soldAt >= ninetyDaysAgo)
    for (const sale of recentAllSales) {
      const weekStart = getWeekStart(sale.soldAt)
      const key = weekStart.toISOString().split('T')[0]
      if (!weekMap.has(key)) weekMap.set(key, { ebay: 0, depop: 0 })
      const entry = weekMap.get(key)!
      if (sale.platform === 'EBAY') entry.ebay += sale.salePrice
      else entry.depop += sale.salePrice
    }
  } else {
    // Derive from sold listings using updatedAt as approximate sale date
    const recentSold = soldListings.filter((l) => l.updatedAt >= ninetyDaysAgo)
    for (const listing of recentSold) {
      const weekStart = getWeekStart(listing.updatedAt)
      const key = weekStart.toISOString().split('T')[0]
      if (!weekMap.has(key)) weekMap.set(key, { ebay: 0, depop: 0 })
      const entry = weekMap.get(key)!
      const platform = listing.platforms[0]?.platform
      if (platform === 'EBAY') entry.ebay += listing.price
      else entry.depop += listing.price
    }
  }

  // Platform comparison
  type SaleItem = { price: number; createdAt: Date; soldAt: Date; platform: string }
  let ebaySaleItems: SaleItem[] = []
  let depopSaleItems: SaleItem[] = []
  if (hasSaleRecords) {
    ebaySaleItems = sales.filter((s) => s.platform === 'EBAY').map((s) => ({
      price: s.salePrice, createdAt: s.listing.createdAt, soldAt: s.soldAt, platform: 'EBAY',
    }))
    depopSaleItems = sales.filter((s) => s.platform === 'DEPOP').map((s) => ({
      price: s.salePrice, createdAt: s.listing.createdAt, soldAt: s.soldAt, platform: 'DEPOP',
    }))
  } else {
    for (const listing of soldListings) {
      const item = {
        price: listing.price, createdAt: listing.createdAt, soldAt: listing.updatedAt,
        platform: listing.platforms[0]?.platform ?? 'DEPOP',
      }
      if (item.platform === 'EBAY') ebaySaleItems.push(item)
      else depopSaleItems.push(item)
    }
  }

  // Calculate avg days to sell
  function avgDaysToSell(items: SaleItem[]): number {
    if (!items.length) return 0
    let totalDays = 0
    for (const s of items) {
      totalDays += Math.max(1, Math.floor((s.soldAt.getTime() - s.createdAt.getTime()) / (24 * 60 * 60 * 1000)))
    }
    return Math.round(totalDays / items.length)
  }

  // Top listings by views (7 days) — fall back to recently updated active listings
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const topAnalytics = await prisma.listingAnalytics.groupBy({
    by: ['listingId'],
    where: { date: { gte: sevenDaysAgo } },
    _sum: { views: true },
    orderBy: { _sum: { views: 'desc' } },
    take: 10,
  })

  const topListingIds = topAnalytics.map((a) => a.listingId)

  let topListings
  if (topListingIds.length > 0) {
    topListings = await prisma.listing.findMany({
      where: { id: { in: topListingIds }, status: 'ACTIVE' },
      include: { platforms: true },
    })
  } else {
    // Fallback: most recently updated active listings (no analytics data yet)
    topListings = await prisma.listing.findMany({
      where: { status: { in: ['ACTIVE', 'DRAFT'] } },
      include: { platforms: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    })
  }

  const topListingsWithViews = topListings.map((l) => {
    const viewData = topAnalytics.find((a) => a.listingId === l.id)
    const daysListed = Math.floor((now.getTime() - l.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    return {
      id: l.id,
      title: l.title,
      photos: l.photos,
      price: l.price,
      platforms: l.platforms.map((p) => p.platform) as ('EBAY' | 'DEPOP')[],
      views7d: viewData?._sum?.views ?? 0,
      daysListed,
      status: l.status,
    }
  })

  const ebayTotalListings = ebayActiveCount + ebaySoldCount
  const depopTotalListings = depopActiveCount + depopSoldCount

  function avgPrice(items: SaleItem[]): number {
    if (!items.length) return 0
    let t = 0
    for (const s of items) t += s.price
    return t / items.length
  }

  const data: AnalyticsData = {
    totalRevenue,
    itemsSold30d,
    avgSalePrice30d,
    sellThroughRate,
    totalListings: totalCount,
    activeListings: activeCount,
    soldListings: soldCount,
    draftListings: draftCount,
    revenueByWeek: Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, vals]) => ({ week, ...vals })),
    platformComparison: {
      ebay: {
        avgPrice: avgPrice(ebaySaleItems),
        avgDaysToSell: avgDaysToSell(ebaySaleItems),
        sellThrough: ebayTotalListings > 0 ? ebaySoldCount / ebayTotalListings : 0,
      },
      depop: {
        avgPrice: avgPrice(depopSaleItems),
        avgDaysToSell: avgDaysToSell(depopSaleItems),
        sellThrough: depopTotalListings > 0 ? depopSoldCount / depopTotalListings : 0,
      },
    },
    topListings: topListingsWithViews,
  }

  return NextResponse.json(data)
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day)
  d.setHours(0, 0, 0, 0)
  return d
}
