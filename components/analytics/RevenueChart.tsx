'use client'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface RevenueChartProps {
  data: Array<{ week: string; ebay: number; depop: number }>
}

export function RevenueChart({ data }: RevenueChartProps) {
  if (!data.length) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No revenue data yet</div>
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
        <Tooltip formatter={(value: number) => [`£${value.toFixed(2)}`, '']} />
        <Legend />
        <Line type="monotone" dataKey="ebay" stroke="#E53238" strokeWidth={2} dot={false} name="eBay" />
        <Line type="monotone" dataKey="depop" stroke="#FF2300" strokeWidth={2} dot={false} name="Depop" />
      </LineChart>
    </ResponsiveContainer>
  )
}
