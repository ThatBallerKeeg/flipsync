'use client'
import { useState } from 'react'
import { Order } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ChevronDown, ChevronUp, Package } from 'lucide-react'

interface Props { orders: Order[] }

export function OrderFeed({ orders }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [platform, setPlatform] = useState<'ALL' | 'EBAY' | 'DEPOP'>('ALL')

  const filtered = orders.filter((o) => platform === 'ALL' || o.platform === platform)

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['ALL', 'EBAY', 'DEPOP'] as const).map((p) => (
          <Button key={p} variant={platform === p ? 'default' : 'outline'} size="sm" onClick={() => setPlatform(p)}>
            {p === 'ALL' ? 'All Platforms' : p === 'EBAY' ? 'eBay' : 'Depop'}
          </Button>
        ))}
        <span className="ml-auto self-center text-sm text-muted-foreground">{filtered.length} orders</span>
      </div>

      <div className="space-y-2">
        {filtered.map((order) => (
          <Card key={order.id} className="overflow-hidden">
            <CardContent className="p-0">
              <button
                className="flex w-full items-center gap-4 p-4 hover:bg-muted/30 text-left"
                onClick={() => setExpanded(expanded === order.id ? null : order.id)}
              >
                <Badge variant={order.platform === 'EBAY' ? 'ebay' : 'depop'}>
                  {order.platform === 'EBAY' ? 'eBay' : 'Depop'}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{order.itemTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.buyerUsername} · {formatDate(order.orderDate)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{formatCurrency(order.salePrice)}</p>
                  <ShippingBadge status={order.shippingStatus} />
                </div>
                {expanded === order.id ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>

              {expanded === order.id && (
                <div className="border-t bg-muted/20 p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Order ID</p>
                      <p className="font-mono">{order.platformOrderId}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Sale Price</p>
                      <p>{formatCurrency(order.salePrice)}</p>
                    </div>
                  </div>
                  {order.buyerMessage && (
                    <div className="text-sm">
                      <p className="text-muted-foreground">Buyer Message</p>
                      <p className="mt-1 rounded bg-muted p-2">{order.buyerMessage}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Input placeholder="Add tracking number..." className="h-8 text-sm" />
                    <Button size="sm" variant="outline">
                      <Package className="mr-1 h-3 w-3" />Mark Shipped
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {!filtered.length && (
          <div className="py-16 text-center text-muted-foreground">
            <Package className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>No orders found</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ShippingBadge({ status }: { status: Order['shippingStatus'] }) {
  const map = { pending: 'amber', shipped: 'green', delivered: 'secondary' } as const
  return <Badge variant={map[status] ?? 'secondary'} className="text-xs">{status}</Badge>
}
