import { NextRequest, NextResponse } from 'next/server'
import { synthesizeValuation } from '@/lib/claude/valuate'
import { searchComparables } from '@/lib/search/comparables'
import { z } from 'zod'

const schema = z.object({
  itemQuery: z.string().min(1),
  condition: z.string().default('good'),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { itemQuery, condition } = parsed.data

  try {
    const comparables = await searchComparables(itemQuery)
    const suggestion = await synthesizeValuation(itemQuery, condition, comparables)
    return NextResponse.json({ ...suggestion, comparables })
  } catch (err) {
    console.error('Price suggestion error:', err)
    return NextResponse.json({ error: 'Price suggestion failed' }, { status: 500 })
  }
}
