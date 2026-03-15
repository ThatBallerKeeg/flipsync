'use client'
import { AIIdentifyResult, ComparableListing, PriceSuggestion } from '@/types'
import { ComparableListings } from './ComparableListings'
import { PriceSuggestion as PriceSuggestionCard } from './PriceSuggestion'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkles } from 'lucide-react'

interface Props {
  identified?: AIIdentifyResult | null
  comparables: ComparableListing[]
  priceSuggestion?: PriceSuggestion | null
  loading?: boolean
  onSelectPrice?: (price: number) => void
}

export function AIAssistPanel({ identified, comparables, priceSuggestion, loading, onSelectPrice }: Props) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">AI Assistant</p>
        {loading && (
          <Badge variant="secondary" className="text-xs animate-pulse">Analysing...</Badge>
        )}
      </div>

      {loading && !identified && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {identified && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[
            ['Brand', identified.brand],
            ['Type', identified.item_type],
            ['Condition', identified.condition],
            ['Size', identified.size],
            ['Color', identified.color],
            ['Material', identified.material],
          ]
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label}>
                <span className="text-xs text-muted-foreground">{label}</span>
                <p className="font-medium capitalize">{value}</p>
              </div>
            ))}
          {identified.notable_features?.length ? (
            <div className="col-span-2">
              <span className="text-xs text-muted-foreground">Features</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {identified.notable_features.map((f) => (
                  <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {priceSuggestion && (
        <PriceSuggestionCard suggestion={priceSuggestion} onSelectPrice={onSelectPrice} />
      )}

      {(comparables.length > 0 || loading) && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Comparable Sales</p>
          <ComparableListings comparables={comparables} loading={loading && !comparables.length} />
        </div>
      )}
    </div>
  )
}
