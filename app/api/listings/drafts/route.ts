import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { deletePhoto } from '@/lib/storage/photos'

/**
 * DELETE /api/listings/drafts
 *
 * Deletes ALL listings whose status is DRAFT (i.e. never published to any
 * platform). Also best-effort cleans up the photos for each from Supabase
 * Storage. Does NOT touch ACTIVE / SOLD / ENDED / RELISTED listings.
 */
export async function DELETE() {
  try {
    const drafts = await prisma.listing.findMany({
      where: { status: 'DRAFT' },
      select: { id: true, photos: true },
    })

    if (drafts.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 })
    }

    // Best-effort photo cleanup (don't fail the whole request if Storage is flaky)
    const allPhotoUrls = drafts.flatMap((d) => d.photos)
    await Promise.allSettled(allPhotoUrls.map((url) => deletePhoto(url)))

    // Cascade deletes related ListingPlatform / ListingAnalytics via Prisma onDelete: Cascade
    const result = await prisma.listing.deleteMany({
      where: { status: 'DRAFT' },
    })

    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err) {
    console.error('[drafts] DELETE failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
