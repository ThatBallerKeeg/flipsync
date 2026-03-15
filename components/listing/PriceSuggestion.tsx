'use client'
import { PriceSuggestion as PriceSuggestionType } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props {
  suggestion: PriceSuggestionType
  onSelectPrice?: (price: number) => void
}

export function PriceSuggestion({ suggestion, onSelectPrice }: Props) {
  const { low, mid, high, confidence, trend, platform_recommendation } = suggestion
  const trendIcon = trend === 'rising' ? <TrendingUp className="h-4 w-4 text-green-500" /> :
    trend === 'falling' ? <TrendingDown className="h-4 w-4 text-red-500" /> :
    <Minus className="h-4 w-4 text-muted-foreground" />

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">AI Price Suggestion</p>
          <Badge variant={confidence >= 0.7 ? 'green' : 'amber'}>
            {Math.round(confidence * 100)}% conf
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Low', low], ['Mid', mid], ['High', high]].map(([label, price]) => (
            <button
              key={label}
              onClick={() => onSelectPrice?.(price as number)}
              className="rounded-md border bg-background p-2 hover:border-primary transition-colors cursor-pointer"
            >
              <p className="text-xs text-muted-foreground">{label as string}</p>
              <p className="font-semibold">{formatCurrency(price as number)}</p>
            </button>
          ))}
        </div>

        {(trend || platform_recommendation) && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            {trendIcon}
            <p>{platform_recommendation ?? `Market is ${trend}`}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
