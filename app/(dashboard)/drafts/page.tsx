'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Edit, Trash2, Zap, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { useToast } from '@/hooks/useToast'
import { Listing } from '@/types'

export default function DraftsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)

  const { data: drafts = [], isLoading } = useQuery<Listing[]>({
    queryKey: ['drafts'],
    queryFn: () => fetch('/api/listings?status=DRAFT').then((r) => r.json()),
  })

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then((r) => r.json()),
  })

  const autoPublishPerDay = parseInt(settings?.autoPublishPerDay ?? '0', 10)

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/listings/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drafts'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      setConfirmDeleteId(null)
    },
  })

  async function publishNow(id: string) {
    setPublishingId(id)
    try {
      const res = await fetch(`/api/listings/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: ['DEPOP'] }),
      })
      const data = await res.json()
      const success = data.results?.DEPOP?.success
      if (success) {
        toast({ title: 'Published!', description: 'Listing is now live on Depop.' })
        queryClient.invalidateQueries({ queryKey: ['drafts'] })
        queryClient.invalidateQueries({ queryKey: ['listings'] })
      } else {
        toast({
          title: 'Publish failed',
          description: data.results?.DEPOP?.error ?? data.error ?? 'Unknown error',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Publish failed', description: 'Network error', variant: 'destructive' })
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Confirm delete dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg space-y-4">
            <h2 className="text-base font-semibold">Delete draft?</h2>
            <p className="text-sm text-muted-foreground">This will permanently delete this draft listing.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {drafts.length} draft{drafts.length !== 1 ? 's' : ''} queued
            {autoPublishPerDay > 0 && (
              <span className="ml-1">
                — auto-publishing <strong>{autoPublishPerDay}</strong>/day
              </span>
            )}
            {autoPublishPerDay === 0 && (
              <span className="ml-1">
                — <Link href="/settings" className="text-primary hover:underline">set up auto-publish</Link>
              </span>
            )}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/listings/new">
            <Plus className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">New Listing</span>
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : drafts.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-muted-foreground text-sm">
          No drafts.{' '}
          <Link href="/listings/new" className="text-primary hover:underline">Create a listing →</Link>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 lg:hidden">
            {drafts.map((listing) => (
              <div key={listing.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                {listing.photos[0] ? (
                  <img src={listing.photos[0]} alt={listing.title} className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{listing.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">Draft</Badge>
                    <span className="text-xs font-semibold">{formatCurrency(listing.price)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8"
                    disabled={publishingId === listing.id}
                    onClick={() => publishNow(listing.id)}
                  >
                    {publishingId === listing.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                  </Button>
                  <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                    <Link href={`/listings/${listing.id}`}><Edit className="h-4 w-4" /></Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDeleteId(listing.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Item</th>
                  <th className="px-4 py-3 text-left font-medium">Price</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {drafts.map((listing) => (
                  <tr key={listing.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {listing.photos[0] ? (
                          <img src={listing.photos[0]} alt={listing.title} className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted" />
                        )}
                        <span className="font-medium line-clamp-1">{listing.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(listing.price)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(listing.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          disabled={publishingId === listing.id}
                          onClick={() => publishNow(listing.id)}
                        >
                          {publishingId === listing.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Zap className="mr-1 h-4 w-4" />
                          )}
                          Publish Now
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/listings/${listing.id}`}><Edit className="h-4 w-4" /></Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteId(listing.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
