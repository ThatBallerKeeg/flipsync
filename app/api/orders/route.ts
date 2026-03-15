import { NextResponse } from 'next/server'
import { getEbayOrders } from '@/lib/ebay/orders'
import { getDepopOrders } from '@/lib/depop/orders'

export async function GET() {
  const [ebayOrders, depopOrders] = await Promise.allSettled([
    getEbayOrders(),
    getDepopOrders(),
  ])

  const orders = [
    ...(ebayOrders.status === 'fulfilled' ? ebayOrders.value : []),
    ...(depopOrders.status === 'fulfilled' ? depopOrders.value : []),
  ].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())

  return NextResponse.json(orders)
}
