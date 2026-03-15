'use client'
import Link from 'next/link'
import { ValuationResult as ValuationResultType } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface Props { result: ValuationResultType }

export function ValuationResult({ result }: Props) {
  const { priceLow, priceMid, priceHigh, confidence, aiSummary, comparables } = result
  const confidencePct = Math.round(confidence * 100)
  const trendIcon = aiSummary?.trend === 'rising' ? <TrendingUp className="h-4 w-4 text-green-500" /> :
    aiSummary?.trend === 'falling' ? <TrendingDown className="h-4 w-4 text-red-500" /> :
    <Minus className="h-4 w-4 text-muted-foreground" />

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{result.itemQuery}</CardTitle>
            <Badge variant={confidencePct >= 70 ? 'green' : confidencePct >= 40 ? 'amber' : 'secondary'}>
              {confidencePct}% confidence
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Price gauge */}
          <div>
            <div className="flex justify-between text-sm text-muted-foreground mb-2">
              <span>Low</span><span>Recommended</span><span>High</span>
            </div>
            <div className="relative h-4 rounded-full bg-gradient-to-r from-muted via-primary/40 to-primary/80">
              <div
                className="absolute top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-primary shadow-md border-2 border-background"
                style={{ left: `${((priceMid - priceLow) / Math.max(priceHigh - priceLow, 1)) * 90 + 5}%` }}
              />
            </div>
            <div className="flex justify-between mt-3 text-center">
              <div><p className="text-xs text-muted-foreground">Low</p><p className="font-semibold">{formatCurrency(priceLow)}</p></div>
              <div><p className="text-xs text-muted-foreground">Mid</p><p className="text-xl font-bold text-primary">{formatCurrency(priceMid)}</p></div>
              <div><p className="text-xs text-muted-foreground">High</p><p className="font-semibold">{formatCurrency(priceHigh)}</p></div>
            </div>
          </div>

          {/* Trend + recommendation */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {trendIcon}
              <span className="capitalize font-medium">{aiSummary?.trend ?? 'stable'} market</span>
            </div>
            {aiSummary?.platform_recommendation && (
              <p className="text-muted-foreground">{aiSummary.platform_recommendation}</p>
            )}
          </div>

          <Button className="w-full" asChild>
            <Link href={`/listings/new?prefill=${encodeURIComponent(result.itemQuery)}`}>
              Create listing with this item <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Comparables table */}
      {comparables && comparables.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Comparable Sales</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-left font-medium">Platform</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {comparables.slice(0, 6).map((c, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="px-4 py-2 truncate max-w-[200px]">{c.title}</td>
                    <td className="px-4 py-2">
                      <Badge variant={c.platform === 'eBay' ? 'ebay' : 'depop'}>{c.platform}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.price)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{c.soldDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
