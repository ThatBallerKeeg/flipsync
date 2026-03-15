'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Listing } from '@/types'

export function useListings(filters?: { status?: string; platform?: string }) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.platform) params.set('platform', filters.platform)

  return useQuery<Listing[]>({
    queryKey: ['listings', filters],
    queryFn: () => fetch(`/api/listings?${params}`).then((r) => r.json()),
  })
}

export function useListing(id: string) {
  return useQuery<Listing>({
    queryKey: ['listing', id],
    queryFn: () => fetch(`/api/listings/${id}`).then((r) => r.json()),
    enabled: !!id,
  })
}

export function useDeleteListing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetch(`/api/listings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['listings'] }),
  })
}
