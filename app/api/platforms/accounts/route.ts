import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET() {
  const accounts = await prisma.connectedAccount.findMany({
    select: {
      id: true,
      platform: true,
      shopUsername: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json(accounts)
}
