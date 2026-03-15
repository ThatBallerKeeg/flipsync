import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function DELETE() {
  await prisma.connectedAccount.deleteMany({ where: { platform: 'DEPOP' } })
  return NextResponse.json({ ok: true })
}
