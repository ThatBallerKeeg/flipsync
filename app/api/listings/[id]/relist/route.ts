import { NextRequest, NextResponse } from 'next/server'
import { relistListing } from '@/lib/listings/publish'

// Browser automation can take up to 90s
export const maxDuration = 90

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const result = await relistListing(id)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
