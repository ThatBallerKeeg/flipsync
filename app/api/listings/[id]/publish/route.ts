import { NextRequest, NextResponse } from 'next/server'
import { publishListing } from '@/lib/listings/publish'

// Browser automation can take up to 90s
export const maxDuration = 90

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { platforms } = await req.json() as { platforms: ('EBAY' | 'DEPOP')[] }

  try {
    const results = await publishListing(id, platforms)
    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 404 })
  }
}
