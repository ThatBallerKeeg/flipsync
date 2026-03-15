'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Plus, Edit, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { Listing } from '@/types'

const statusColors: Record<string, string> = {
  DRAFT: 'secondary',
  ACTIVE: 'green',
  SOLD: 'ebay',
  ENDED: 'outline',
  RELISTED: 'amber',
}

function statusLabel(status: string) {
  if (status === 'ACTIVE') return 'Listed'
  if (status === 'SOLD') return 'Sold'
  if (status === 'DRAFT') return 'Draft'
  if (status === 'ENDED') return 'Ended'
  return status
}

export default function ListingsPage() {
  const queryClient = useQueryClient()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const { data: listings = [], isLoading } = useQuery<Listing[]>({
    queryKey: ['listings'],
    queryFn: () => fetch('/api/listings').then((r) => r.json()),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/listings/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      setConfirmDeleteId(null)
    },
  })

  async function syncDepop() {
    setSyncing(true)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 90_000)
      const res = await fetch('/api/platforms/depop/sync', { method: 'POST', signal: controller.signal })
      clearTimeout(timeout)
      const data = await res.json()
      await queryClient.invalidateQueries({ queryKey: ['listings'] })
      alert(`Synced ${data.synced ?? 0} listings from Depop`)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        await queryClient.invalidateQueries({ queryKey: ['listings'] })
        alert('Sync is taking a while — check back in a moment, listings are importing in the background.')
      } else {
        alert('Sync failed — make sure Depop is connected in Settings')
      }
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Confirm delete dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-lg space-y-4">
            <h2 className="text-base font-semibold">Delete listing?</h2>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the listing from FlipSync and remove it from any connected platforms.
            </p>
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
        <p className="text-sm text-muted-foreground">{listings.length} listings</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={syncDepop} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''} sm:mr-1`} />
            <span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync Depop'}</span>
          </Button>
          <Button asChild size="sm">
            <Link href="/listings/new">
              <Plus className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">New Listing</span>
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : listings.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-muted-foreground text-sm">
          No listings yet.{' '}
          <Link href="/listings/new" className="text-primary hover:underline">Create your first listing →</Link>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="flex flex-col gap-2 lg:hidden">
            {listings.map((listing) => (
              <div key={listing.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                {listing.photos[0] ? (
                  <img src={listing.photos[0]} alt={listing.title} className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium">{listing.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant={statusColors[listing.status] as 'secondary' | 'green' | 'ebay' | 'outline' | 'amber' | 'default'}>
                      {statusLabel(listing.status)}
                    </Badge>
                    {listing.platforms?.map((p) => (
                      <Badge key={p.platform} variant={p.platform === 'EBAY' ? 'ebay' : 'depop'}>
                        {p.platform === 'EBAY' ? 'eBay' : 'Depop'}
                      </Badge>
                    ))}
                    <span className="text-xs font-semibold">{formatCurrency(listing.price)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
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
                  <th className="px-4 py-3 text-left font-medium">Platform</th>
                  <th className="px-4 py-3 text-left font-medium">Price</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {listings.map((listing) => (
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
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {listing.platforms?.map((p) => (
                          <Badge key={p.platform} variant={p.platform === 'EBAY' ? 'ebay' : 'depop'}>
                            {p.platform === 'EBAY' ? 'eBay' : 'Depop'}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(listing.price)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusColors[listing.status] as 'secondary' | 'green' | 'ebay' | 'outline' | 'amber' | 'default'}>
                        {statusLabel(listing.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatRelativeTime(listing.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
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
