import { depopFetch } from './client'
import { Order } from '@/types'

export async function getDepopOrders(): Promise<Order[]> {
  const res = await depopFetch('/orders/selling/')
  if (!res.ok) return []
  const data = await res.json()

  return (data.objects ?? []).map((o: Record<string, unknown>) => {
    const item = (o.items as Record<string, unknown>[])?.[0] ?? {}
    return {
      id: String(o.id),
      platform: 'DEPOP' as const,
      platformOrderId: String(o.id),
      itemTitle: item.description as string ?? '',
      salePrice: typeof o.total_amount === 'number' ? o.total_amount / 100 : 0,
      buyerUsername: (o.buyer as Record<string, unknown>)?.username as string ?? '',
      orderDate: new Date(o.created as string),
      shippingStatus: mapStatus(o.status as string),
      buyerMessage: o.note as string ?? undefined,
    } as Order
  })
}

function mapStatus(status: string): Order['shippingStatus'] {
  if (status === 'Shipped') return 'shipped'
  if (status === 'Completed') return 'delivered'
  return 'pending'
}
