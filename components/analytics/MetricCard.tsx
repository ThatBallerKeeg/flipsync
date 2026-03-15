import { Card, CardContent } from '@/components/ui/card'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: string
  trend?: string
  trendUp?: boolean
}

export function MetricCard({ title, value, trend, trendUp = true }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
        {trend && (
          <div className={cn('mt-1 flex items-center gap-1 text-xs', trendUp ? 'text-green-600' : 'text-red-500')}>
            {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
