/**
 * POST /api/listings/bulk-build
 *
 * Accepts multipart form data with any number of photo files.
 * 1. Uploads all photos to Supabase (parallel, with EXIF rotation)
 * 2. Creates a BulkJob record in the database
 * 3. Fires background processing (no await — runs after response returns)
 * 4. Returns { jobId } immediately so the client doesn't need to stay connected
 *
 * Background processing (processJob):
 *   - Groups photos by item using Claude Vision
 *   - Identifies each item (Sonnet)
 *   - Fetches price comparables + AI valuation (Haiku)
 *   - Creates DRAFT listings
 *   - Writes progress to BulkJob row after every listing
 *   - Handles Anthropic rate limits automatically via withRetry
 *
 * Railway runs a persistent Node.js server, so background async tasks
 * continue running after the HTTP response is sent.
 */
import { NextRequest, NextResponse } from 'next/server'
import { uploadPhoto } from '@/lib/storage/photos'
import { groupPhotosByItem } from '@/lib/claude/group-photos'
import { identifyItemFromImage } from '@/lib/claude/identify'
import { searchComparables } from '@/lib/search/comparables'
import { synthesizeValuation } from '@/lib/claude/valuate'
import { prisma } from '@/lib/db/client'
import type { AIIdentifyResult } from '@/types'
import type { Prisma } from '@prisma/client'

export const maxDuration = 60 // only covers upload + job creation; background runs indefinitely

type JobResult =
  | { ok: true; id: string; title: string; price: number; index: number }
  | { ok: false; error: string; index: number }

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const files = form.getAll('photos') as File[]

  if (!files.length) {
    return NextResponse.json({ error: 'No photos received' }, { status: 400 })
  }

  // Upload all photos to Supabase in parallel (includes EXIF auto-rotation)
  const uploadResults = await Promise.allSettled(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer())
      return uploadPhoto(buffer, file.name || 'photo.jpg', file.type || 'image/jpeg')
    })
  )

  const urls = uploadResults
    .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
    .map((r) => r.value)

  if (!urls.length) {
    return NextResponse.json({ error: 'All photo uploads failed' }, { status: 500 })
  }

  // Create the job record — background worker will update it as it progresses
  const job = await prisma.bulkJob.create({
    data: {
      status: 'processing',
      phase: 'grouping',
      totalPhotos: urls.length,
    },
  })

  // Fire background processing without awaiting — Railway keeps the event loop alive
  void processJob(job.id, urls).catch(async (err: unknown) => {
    console.error('[BulkJob] Fatal background error:', err)
    await prisma.bulkJob.update({
      where: { id: job.id },
      data: { status: 'error', error: String(err) },
    }).catch(() => {})
  })

  return NextResponse.json({ jobId: job.id, totalPhotos: urls.length })
}

async function processJob(jobId: string, urls: string[]) {
  const results: JobResult[] = []

  // ── 1. Group photos by item ──
  const groups = await groupPhotosByItem(urls)

  await prisma.bulkJob.update({
    where: { id: jobId },
    data: { phase: 'building', totalGroups: groups.length },
  })

  // ── 2. Process each group (sequential to avoid hammering rate limits) ──
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    const selectedUrls = group.selectedIndices.map((idx) => urls[idx]).filter(Boolean)
    const allGroupUrls = group.photoIndices.map((idx) => urls[idx]).filter(Boolean)
    const groupUrls = selectedUrls.length > 0 ? selectedUrls : allGroupUrls

    if (!groupUrls.length) continue

    try {
      // Identify item (Sonnet, with rate-limit retry baked into identifyItemFromImage)
      const id = await identifyItemFromImage(groupUrls)

      // Price suggestion (best-effort — never fails the listing)
      const itemQuery = [id.brand, id.item_type, id.model_name].filter(Boolean).join(' ')
      let price = 25
      try {
        const comps = await searchComparables(itemQuery)
        const valuation = await synthesizeValuation(itemQuery, id.condition ?? 'good', comps)
        if (valuation.mid > 0) price = Math.round(valuation.mid)
      } catch { /* use $25 default */ }

      const description = buildDescription(id)
      const title =
        id.suggested_title ||
        [id.brand, id.item_type].filter(Boolean).join(' ') ||
        group.hint ||
        'New Item'

      const listing = await prisma.listing.create({
        data: {
          title: title.slice(0, 80),
          description,
          depopDescription: description,
          price,
          photos: groupUrls,
          brand: id.brand || undefined,
          size: id.size || undefined,
          color: id.color || undefined,
          condition: id.condition || undefined,
          category: id.suggested_category_depop || undefined,
          tags: id.tags ?? [],
          status: 'DRAFT',
          aiData: id as unknown as Prisma.InputJsonValue,
        },
      })

      results.push({ ok: true, id: listing.id, title: listing.title, price, index: i })
    } catch (err) {
      results.push({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        index: i,
      })
    }

    // Persist progress after every group so the client sees real-time updates
    await prisma.bulkJob.update({
      where: { id: jobId },
      data: {
        created: results.filter((r) => r.ok).length,
        results: results as unknown as Prisma.InputJsonValue,
      },
    })
  }

  // ── 3. Mark job done ──
  await prisma.bulkJob.update({
    where: { id: jobId },
    data: { status: 'done', phase: 'done' },
  })
}

function buildDescription(id: AIIdentifyResult): string {
  const header = [id.brand, id.item_type, id.model_name].filter(Boolean).join(' ')
  const lines: string[] = []
  if (header) lines.push(header)

  const details: string[] = []
  if (id.condition) details.push(`Condition: ${id.condition.replace(/_/g, ' ')}`)
  if (id.size) details.push(`Size: ${id.size}`)
  if (id.color) details.push(`Color: ${id.color}`)
  if (id.material) details.push(`Material: ${id.material}`)
  if (details.length) lines.push(details.join(' · '))

  if (id.notable_features?.length) {
    lines.push(id.notable_features.slice(0, 4).join(', '))
  }

  lines.push('DM with any questions — open to offers! 🤝')

  const body = lines.join('\n')
  const hashtags = (id.tags ?? []).map((t) => `#${t}`).join(' ')
  return hashtags ? `${body}\n\n${hashtags}` : body
}
