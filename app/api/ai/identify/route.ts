import { NextRequest, NextResponse } from 'next/server'
import { identifyItemFromImage } from '@/lib/claude/identify'
import { z } from 'zod'

const schema = z.object({
  imageUrl: z.string().min(1).optional(),
  imageUrls: z.array(z.string().min(1)).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'imageUrl or imageUrls required' }, { status: 400 })
  }

  const urls = parsed.data.imageUrls ?? (parsed.data.imageUrl ? [parsed.data.imageUrl] : [])
  if (!urls.length) return NextResponse.json({ error: 'No image URLs provided' }, { status: 400 })

  try {
    const result = await identifyItemFromImage(urls)
    return NextResponse.json(result)
  } catch (err) {
    console.error('AI identify error:', err)
    return NextResponse.json({ error: 'AI identification failed' }, { status: 500 })
  }
}
