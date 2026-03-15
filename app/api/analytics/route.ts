import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { AnalyticsData } from '@/types'

export async function GET() {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  // Total revenue
  const sales = await prisma.sale.findMany({
    include: { listing: { select: { title: true, photos: true } } },
  })
  const totalRevenue = sales.reduce((s: number, sale) => s + sale.salePrice, 0)

  // Last 30 days
  const recentSales = sales.filter((s) => s.soldAt >= thirtyDaysAgo)
  const itemsSold30d = recentSales.length
  const avgSalePrice30d = itemsSold30d ? recentSales.reduce((s: number, sale) => s + sale.salePrice, 0) / itemsSold30d : 0

  // Listing counts
  const [activeCount, soldCount, draftCount, totalCount] = await Promise.all([
    prisma.listing.count({ where: { status: 'ACTIVE' } }),
    prisma.listing.count({ where: { status: 'SOLD' } }),
    prisma.listing.count({ where: { status: 'DRAFT' } }),
    prisma.listing.count(),
  ])
  const sellThroughRate = activeCount + soldCount > 0 ? soldCount / (activeCount + soldCount) : 0

  // Revenue by week (last 90 days)
  const analytics = await prisma.listingAnalytics.findMany({
    where: { date: { gte: ninetyDaysAgo } },
  })

  // Group analytics by week and platform
  const weekMap = new Map<string, { ebay: number; depop: number }>()
  for (const a of analytics) {
    const weekStart = getWeekStart(a.date)
    const key = weekStart.toISOString().split('T')[0]
    if (!weekMap.has(key)) weekMap.set(key, { ebay: 0, depop: 0 })
    const entry = weekMap.get(key)!
    if (a.platform === 'EBAY') entry.ebay += a.views
    else entry.depop += a.views
  }

  // Platform comparison from sales
  const ebaySales = sales.filter((s) => s.platform === 'EBAY')
  const depopSales = sales.filter((s) => s.platform === 'DEPOP')

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
        avgPrice: ebaySales.length ? ebaySales.reduce((s: number, sale) => s + sale.salePrice, 0) / ebaySales.length : 0,
        avgDaysToSell: 0,
        sellThrough: activeCount ? ebaySales.length / (activeCount + ebaySales.length) : 0,
      },
      depop: {
        avgPrice: depopSales.length ? depopSales.reduce((s: number, sale) => s + sale.salePrice, 0) / depopSales.length : 0,
        avgDaysToSell: 0,
        sellThrough: activeCount ? depopSales.length / (activeCount + depopSales.length) : 0,
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
