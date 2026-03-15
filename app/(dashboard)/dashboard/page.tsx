'use client'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { MetricCard } from '@/components/analytics/MetricCard'
import { Skeleton } from '@/components/ui/skeleton'

const RevenueChart = dynamic(
  () => import('@/components/analytics/RevenueChart').then((m) => ({ default: m.RevenueChart })),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> }
)
const PlatformComparisonBar = dynamic(
  () => import('@/components/analytics/PlatformComparisonBar').then((m) => ({ default: m.PlatformComparisonBar })),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> }
)
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'
import { AnalyticsData } from '@/types'

export default function DashboardPage() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: () => fetch('/api/analytics').then((r) => r.json()),
  })

  if (isLoading) return <DashboardSkeleton />

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard title="Listed" value={String(data?.activeListings ?? 0)} trend="" />
        <MetricCard title="Sold" value={String(data?.soldListings ?? 0)} trend="" />
        <MetricCard
          title="Sell-Through Rate"
          value={data?.sellThroughRate ? `${Math.round(data.sellThroughRate * 100)}%` : '0%'}
          trend=""
        />
        <MetricCard title="Total Revenue" value={formatCurrency(data?.totalRevenue ?? 0)} trend="" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueChart data={data?.revenueByWeek ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platform Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformComparisonBar data={data?.platformComparison} />
          </CardContent>
        </Card>
      </div>

      {/* Top Listings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Listings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {(data?.topListings ?? []).map((listing) => (
              <Link
                key={listing.id}
                href={`/listings/${listing.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 lg:gap-4 lg:px-6"
              >
                {listing.photos[0] ? (
                  <img src={listing.photos[0]} alt={listing.title} className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-10 w-10 shrink-0 rounded bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{listing.title}</p>
                  <div className="flex gap-1 mt-0.5">
                    {listing.platforms.includes('EBAY') && <Badge variant="ebay">eBay</Badge>}
                    {listing.platforms.includes('DEPOP') && <Badge variant="depop">Depop</Badge>}
                  </div>
                </div>
                <div className="text-right text-sm shrink-0">
                  <p className="font-medium">{formatCurrency(listing.price)}</p>
                  <p className="text-muted-foreground hidden sm:block">{listing.daysListed}d listed</p>
                </div>
              </Link>
            ))}
            {!data?.topListings?.length && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No listings yet.{' '}
                <Link href="/listings/new" className="text-primary hover:underline">Create your first →</Link>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}
