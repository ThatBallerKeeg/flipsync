'use client'
import { ComparableListing } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'

interface Props {
  comparables: ComparableListing[]
  loading?: boolean
}

export function ComparableListings({ comparables, loading }: Props) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    )
  }

  if (!comparables.length) {
    return <p className="text-sm text-muted-foreground py-2">No comparables found</p>
  }

  return (
    <div className="space-y-1.5">
      {comparables.slice(0, 6).map((c, i) => (
        <div key={i} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant={c.platform === 'eBay' ? 'ebay' : 'depop'} className="shrink-0">{c.platform}</Badge>
            <p className="truncate text-sm">{c.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-sm font-semibold">{formatCurrency(c.price)}</span>
            {c.soldDate && <span className="text-xs text-muted-foreground">{c.soldDate}</span>}
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
