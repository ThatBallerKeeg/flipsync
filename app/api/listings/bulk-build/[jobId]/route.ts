import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const job = await prisma.bulkJob.findUnique({ where: { id: params.jobId } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  return NextResponse.json(job)
}
