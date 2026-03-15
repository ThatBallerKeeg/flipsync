'use client'
import { useQuery } from '@tanstack/react-query'
import { OrderFeed } from '@/components/orders/OrderFeed'
import { Skeleton } from '@/components/ui/skeleton'
import { Order } from '@/types'

export default function OrdersPage() {
  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: () => fetch('/api/orders').then((r) => r.json()),
  })

  if (isLoading) return <Skeleton className="h-[600px]" />

  return <OrderFeed orders={orders} />
}
