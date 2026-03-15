import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { platforms: true, analytics: true, sale: true },
  })
  if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(listing)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const listing = await prisma.listing.update({
    where: { id },
    data: body,
    include: { platforms: true },
  })
  return NextResponse.json(listing)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Attempt to delete from Depop before removing DB record
  const depopPlatform = await prisma.listingPlatform.findFirst({
    where: { listingId: id, platform: 'DEPOP', platformListingId: { not: null } },
  })
  if (depopPlatform?.platformListingId) {
    try {
      const { depopFetch } = await import('@/lib/depop/client')
      await depopFetch(`/products/${depopPlatform.platformListingId}/`, { method: 'DELETE' })
      console.log('[Delete] Removed from Depop:', depopPlatform.platformListingId)
    } catch (e) {
      console.warn('[Delete] Could not remove from Depop:', e)
      // Non-fatal — continue to delete locally
    }
  }

  await prisma.listing.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
