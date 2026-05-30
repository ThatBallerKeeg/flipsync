import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

/**
 * GET /api/photos/[id]
 *
 * Serves a photo stored in the database. Photos are stored as raw bytes (BYTEA)
 * in the Photo table and cached aggressively on the client since they are immutable.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const photo = await prisma.photo.findUnique({ where: { id } })

    if (!photo) {
      return new NextResponse(null, { status: 404 })
    }

    const data = photo.data as Buffer
    const bytes = new Uint8Array(data)

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': photo.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(photo.size || data.length),
      },
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
