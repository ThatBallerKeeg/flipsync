import { NextRequest, NextResponse } from 'next/server'
import { searchComparables } from '@/lib/search/comparables'

export async function GET(req: NextRequest) {
  const query = new URL(req.url).searchParams.get('q')
  if (!query) return NextResponse.json({ error: 'q param required' }, { status: 400 })

  try {
    const results = await searchComparables(query)
    return NextResponse.json({ results })
  } catch (err) {
    console.error('Comparables search error:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
