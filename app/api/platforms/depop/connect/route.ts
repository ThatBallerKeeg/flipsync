import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { storeDepopToken } from '@/lib/depop/auth'

const schema = z.object({
  token: z.string().min(10),
  username: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Token and username are required.' }, { status: 400 })
  }

  try {
    await storeDepopToken(parsed.data.token, parsed.data.username)
    return NextResponse.json({ ok: true, username: parsed.data.username })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to store token'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
