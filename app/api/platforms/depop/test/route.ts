import { NextResponse } from 'next/server'
import { depopFetch } from '@/lib/depop/client'

export async function GET() {
  try {
    const res = await depopFetch('/users/me/')
    return NextResponse.json({ status: res.status, ok: res.ok, body: res.json() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
