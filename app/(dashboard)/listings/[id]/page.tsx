'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { ListingForm } from '@/components/listing/ListingForm'
import { Skeleton } from '@/components/ui/skeleton'
import { Listing } from '@/types'

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()

  const { data: listing, isLoading } = useQuery<Listing>({
    queryKey: ['listing', id],
    queryFn: () => fetch(`/api/listings/${id}`).then((r) => r.json()),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Listing>) =>
      fetch(`/api/listings/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings'] })
      qc.invalidateQueries({ queryKey: ['listing', id] })
    },
  })

  if (isLoading) return <Skeleton className="h-[600px]" />
  if (!listing) return <p className="text-muted-foreground">Listing not found</p>

  return (
    <ListingForm
      initialData={listing}
      onSave={(data) => updateMutation.mutateAsync(data)}
      onPublish={async (platforms) => {
        await fetch(`/api/listings/${id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platforms }),
        })
        qc.invalidateQueries({ queryKey: ['listings'] })
      }}
    />
  )
}
