import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  // eBay webhook events (e.g. ITEM_SOLD)
  const body = await req.text()
  console.log('[eBay webhook]', body.substring(0, 200))
  return NextResponse.json({ ok: true })
}
