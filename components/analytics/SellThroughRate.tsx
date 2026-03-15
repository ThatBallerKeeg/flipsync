import { Card, CardContent } from '@/components/ui/card'

interface Props { rate: number }

export function SellThroughRate({ rate }: Props) {
  const pct = Math.round(rate * 100)
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">Sell-Through Rate</p>
        <p className="mt-1 text-3xl font-bold">{pct}%</p>
        <div className="mt-2 h-2 w-full rounded-full bg-muted">
          <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  )
}
