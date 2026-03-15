import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { identifyItemFromImage } from '@/lib/claude/identify'
import { searchComparables } from '@/lib/search/comparables'
import { synthesizeValuation } from '@/lib/claude/valuate'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const schema = z.object({
  itemQuery: z.string().min(1),
  condition: z.string().default('good'),
  imageUrl: z.string().url().optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  let { itemQuery, condition, imageUrl } = parsed.data
  const platformData: Record<string, unknown> = {}

  try {
    // Step 1: If image provided, identify item first
    if (imageUrl) {
      const identified = await identifyItemFromImage(imageUrl)
      platformData.identified = identified
      if (identified.suggested_title) itemQuery = identified.suggested_title
      if (identified.condition) condition = identified.condition
    }

    // Step 2: Search comparables
    const comparables = await searchComparables(itemQuery)
    platformData.comparables = comparables

    // Step 3: Synthesize valuation with Claude
    const aiSummary = await synthesizeValuation(itemQuery, condition, comparables)
    platformData.aiSummary = aiSummary

    // Step 4: Save to DB
    const valuation = await prisma.valuation.create({
      data: {
        itemQuery,
        photoUrl: imageUrl,
        platformData: platformData as unknown as Prisma.InputJsonValue,
        aiSummary: aiSummary as unknown as Prisma.InputJsonValue,
        priceLow: aiSummary.low,
        priceMid: aiSummary.mid,
        priceHigh: aiSummary.high,
        confidence: aiSummary.confidence,
      },
    })

    return NextResponse.json({ ...valuation, comparables })
  } catch (err) {
    console.error('Valuate error:', err)
    return NextResponse.json({ error: 'Valuation failed' }, { status: 500 })
  }
}

export async function GET() {
  const valuations = await prisma.valuation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  return NextResponse.json(valuations)
}
