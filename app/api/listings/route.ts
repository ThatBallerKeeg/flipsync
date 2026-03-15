import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const createSchema = z.object({
  title: z.string().min(1).default('Depop Listing'),
  price: z.coerce.number().positive(),
  description: z.string().optional(),
  depopDescription: z.string().optional(),
  ebayDescription: z.string().optional(),
  originalPrice: z.coerce.number().optional(),
  category: z.string().optional(),
  condition: z.string().optional(),
  brand: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).default([]),
  photos: z.array(z.string()).default([]),
  aiData: z.record(z.unknown()).optional(),
  comparables: z.array(z.unknown()).optional(),
})

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') as 'DRAFT' | 'ACTIVE' | 'SOLD' | 'ENDED' | 'RELISTED' | undefined
  const platform = searchParams.get('platform') as 'DEPOP' | 'EBAY' | undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (platform) where.platforms = { some: { platform } }

  const listings = await prisma.listing.findMany({
    where,
    include: { platforms: true, sale: true },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(listings)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { aiData, comparables, ...rest } = parsed.data

  const listing = await prisma.listing.create({
    data: {
      ...rest,
      aiData: aiData as unknown as Prisma.InputJsonValue,
      comparables: comparables as unknown as Prisma.InputJsonValue,
    },
    include: { platforms: true },
  })

  return NextResponse.json(listing, { status: 201 })
}
