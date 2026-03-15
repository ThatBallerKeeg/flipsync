'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { AnalyticsData } from '@/types'

interface Props {
  data?: AnalyticsData['platformComparison']
}

export function PlatformComparisonBar({ data }: Props) {
  if (!data) return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No comparison data yet</div>

  const chartData = [
    { metric: 'Avg Price', eBay: data.ebay.avgPrice, Depop: data.depop.avgPrice },
    { metric: 'Days to Sell', eBay: data.ebay.avgDaysToSell, Depop: data.depop.avgDaysToSell },
    { metric: 'Sell-Through %', eBay: Math.round(data.ebay.sellThrough * 100), Depop: Math.round(data.depop.sellThrough * 100) },
  ]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="eBay" fill="#E53238" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Depop" fill="#FF2300" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
