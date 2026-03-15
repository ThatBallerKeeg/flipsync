import { ebayFetch } from './client'
import { Order } from '@/types'

export async function getEbayOrders(days = 30): Promise<Order[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const res = await ebayFetch(
    `/sell/fulfillment/v1/order?filter=creationdate:[${since}..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}&limit=50`
  )

  if (!res.ok) return []
  const data = await res.json()

  return (data.orders ?? []).map((o: Record<string, unknown>) => {
    const lineItem = (o.lineItems as Record<string, unknown>[])?.[0] ?? {}
    const buyer = o.buyer as Record<string, unknown>
    const fulfillment = (o.fulfillmentStartInstructions as Record<string, unknown>[])?.[0]
    const shippingStep = fulfillment?.shippingStep as Record<string, unknown> | undefined

    return {
      id: o.orderId as string,
      platform: 'EBAY' as const,
      platformOrderId: o.orderId as string,
      itemTitle: lineItem.title as string ?? '',
      salePrice: ((o.pricingSummary as Record<string, unknown>)?.total as Record<string, unknown>)?.value
        ? parseFloat(String(((o.pricingSummary as Record<string, unknown>)?.total as Record<string, unknown>)?.value))
        : 0,
      buyerUsername: buyer?.username as string ?? '',
      buyerAddress: shippingStep?.shipTo as Record<string, unknown>,
      orderDate: new Date(o.creationDate as string),
      shippingStatus: mapFulfillmentStatus(o.orderFulfillmentStatus as string),
    } as Order
  })
}

function mapFulfillmentStatus(status: string): Order['shippingStatus'] {
  if (status === 'FULFILLED') return 'shipped'
  if (status === 'NOT_STARTED') return 'pending'
  return 'pending'
}
