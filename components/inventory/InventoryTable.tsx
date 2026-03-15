'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Listing } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { Edit, Copy, XCircle, RefreshCw, AlertTriangle, Search } from 'lucide-react'
import { useToast } from '@/hooks/useToast'

interface Props { listings: Listing[] }

const statusBadge: Record<string, 'secondary'|'green'|'ebay'|'outline'|'amber'> = {
  DRAFT: 'secondary', ACTIVE: 'green', SOLD: 'ebay', ENDED: 'outline', RELISTED: 'amber',
}

export function InventoryTable({ listings }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [platformFilter, setPlatformFilter] = useState('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { toast } = useToast()
  const qc = useQueryClient()

  const now = new Date()

  const filtered = listings.filter((l) => {
    if (statusFilter !== 'ALL' && l.status !== statusFilter) return false
    if (platformFilter !== 'ALL' && !l.platforms?.some((p) => p.platform === platformFilter)) return false
    if (search && !l.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }

  const isAtRisk = (l: Listing) => {
    if (l.status !== 'ACTIVE') return false
    const daysListed = (now.getTime() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    return daysListed >= 21
  }

  async function duplicate(listing: Listing) {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...listing, id: undefined, status: 'DRAFT', platforms: undefined }),
    })
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['listings'] })
      toast({ title: 'Duplicated', description: 'Draft copy created.' })
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search listings..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SOLD">Sold</SelectItem>
            <SelectItem value="ENDED">Ended</SelectItem>
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Platforms</SelectItem>
            <SelectItem value="EBAY">eBay</SelectItem>
            <SelectItem value="DEPOP">Depop</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-sm">
          <span className="text-muted-foreground">{selected.size} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="w-8 px-4 py-3">
                <input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((l) => l.id)) : new Set())} />
              </th>
              <th className="px-4 py-3 text-left font-medium">Item</th>
              <th className="px-4 py-3 text-left font-medium">Platforms</th>
              <th className="px-4 py-3 text-left font-medium">Price</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Listed</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((listing) => {
              const atRisk = isAtRisk(listing)
              const daysListed = Math.floor((now.getTime() - new Date(listing.createdAt).getTime()) / (1000 * 60 * 60 * 24))
              return (
                <tr key={listing.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(listing.id)} onChange={() => toggleSelect(listing.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {listing.photos[0] ? (
                        <img src={listing.photos[0]} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-muted shrink-0" />
                      )}
                      <div>
                        <p className="font-medium line-clamp-1">{listing.title}</p>
                        {atRisk && (
                          <div className="flex items-center gap-1 text-amber-600 text-xs mt-0.5">
                            <AlertTriangle className="h-3 w-3" />Consider repricing
                          </div>
                        )}
                      </div>
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
                    <Badge variant={statusBadge[listing.status] ?? 'secondary'}>{listing.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{daysListed}d ago</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" asChild title="Edit">
                        <Link href={`/listings/${listing.id}`}><Edit className="h-4 w-4" /></Link>
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => duplicate(listing)} title="Duplicate">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  No listings match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
