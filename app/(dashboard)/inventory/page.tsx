'use client'
import { useQuery } from '@tanstack/react-query'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { Skeleton } from '@/components/ui/skeleton'
import { Listing } from '@/types'

export default function InventoryPage() {
  const { data: listings = [], isLoading } = useQuery<Listing[]>({
    queryKey: ['listings'],
    queryFn: () => fetch('/api/listings').then((r) => r.json()),
  })

  if (isLoading) return <Skeleton className="h-[600px]" />

  return <InventoryTable listings={listings} />
}
