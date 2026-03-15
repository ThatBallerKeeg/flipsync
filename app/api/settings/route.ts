import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const rows = await prisma.appSettings.findMany()
  const settings: Record<string, string> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }
  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  const { key, value } = await req.json() as { key: string; value: string }

  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  await prisma.appSettings.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value) },
  })

  return NextResponse.json({ key, value })
}
