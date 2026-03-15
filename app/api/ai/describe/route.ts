import { NextRequest, NextResponse } from 'next/server'
import { generateDepopDescription } from '@/lib/claude/describe'
import { z } from 'zod'

const schema = z.object({
  itemData: z.record(z.unknown()),
  comparables: z.array(z.unknown()).default([]),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const depop = await generateDepopDescription(
      parsed.data.itemData as Parameters<typeof generateDepopDescription>[0],
      parsed.data.comparables as Parameters<typeof generateDepopDescription>[1]
    )
    return NextResponse.json({ depop })
  } catch (err) {
    console.error('AI describe error:', err)
    return NextResponse.json({ error: 'Description generation failed' }, { status: 500 })
  }
}
