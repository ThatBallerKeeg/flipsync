import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.text()
  console.log('[Depop webhook]', body.substring(0, 200))
  return NextResponse.json({ ok: true })
}
