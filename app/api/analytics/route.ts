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
  let totalRevenue = 0
  for (const sale of sales) totalRevenue += sale.salePrice

  // Last 30 days
  const recentSales = sales.filter((s) => s.soldAt >= thirtyDaysAgo)
  const itemsSold30d = recentSales.length
  let recentRevenue = 0
  for (const sale of recentSales) recentRevenue += sale.salePrice
  const avgSalePrice30d = itemsSold30d ? recentRevenue / itemsSold30d : 0

  // Listing counts (total + per-platform active counts for sell-through)
  const [activeCount, soldCount, draftCount, totalCount] = await Promise.all([
    prisma.listing.count({ where: { status: 'ACTIVE' } }),
    prisma.listing.count({ where: { status: 'SOLD' } }),
    prisma.listing.count({ where: { status: 'DRAFT' } }),
    prisma.listing.count(),
  ])
  const sellThroughRate = activeCount + soldCount > 0 ? soldCount / (activeCount + soldCount) : 0

  // Per-platform active listing counts for platform-specific sell-through
  const [ebayActiveCount, depopActiveCount] = await Promise.all([
    prisma.listingPlatform.count({
      where: { platform: 'EBAY', listing: { status: 'ACTIVE' } },
    }),
    prisma.listingPlatform.count({
      where: { platform: 'DEPOP', listing: { status: 'ACTIVE' } },
    }),
  ])

  // Revenue by week from ACTUAL SALES (last 90 days)
  const recentAllSales = sales.filter((s) => s.soldAt >= ninetyDaysAgo)
  const weekMap = new Map<string, { ebay: number; depop: number }>()
  for (const sale of recentAllSales) {
    const weekStart = getWeekStart(sale.soldAt)
    const key = weekStart.toISOString().split('T')[0]
    if (!weekMap.has(key)) weekMap.set(key, { ebay: 0, depop: 0 })
    const entry = weekMap.get(key)!
    if (sale.platform === 'EBAY') entry.ebay += sale.salePrice
    else entry.depop += sale.salePrice
  }

  // Platform comparison from sales
  const ebaySales = sales.filter((s) => s.platform === 'EBAY')
  const depopSales = sales.filter((s) => s.platform === 'DEPOP')

  // Calculate avg days to sell per platform
  function avgDaysToSell(platformSales: typeof sales): number {
    const withDays = platformSales.filter((s) => s.listing?.createdAt)
    if (!withDays.length) return 0
    let totalDays = 0
    for (const s of withDays) {
      totalDays += Math.max(1, Math.floor((s.soldAt.getTime() - s.listing.createdAt.getTime()) / (24 * 60 * 60 * 1000)))
    }
    return Math.round(totalDays / withDays.length)
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

  const ebayTotalListings = ebayActiveCount + ebaySales.length
  const depopTotalListings = depopActiveCount + depopSales.length

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
        avgPrice: (() => { let t = 0; for (const s of ebaySales) t += s.salePrice; return ebaySales.length ? t / ebaySales.length : 0 })(),
        avgDaysToSell: avgDaysToSell(ebaySales),
        sellThrough: ebayTotalListings > 0 ? ebaySales.length / ebayTotalListings : 0,
      },
      depop: {
        avgPrice: (() => { let t = 0; for (const s of depopSales) t += s.salePrice; return depopSales.length ? t / depopSales.length : 0 })(),
        avgDaysToSell: avgDaysToSell(depopSales),
        sellThrough: depopTotalListings > 0 ? depopSales.length / depopTotalListings : 0,
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
