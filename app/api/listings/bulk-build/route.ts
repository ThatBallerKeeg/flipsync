/**
 * POST /api/listings/bulk-build
 *
 * Accepts multipart form data with multiple photo files.
 * Groups photos by item using Claude Vision, then for each group:
 *   1. Identifies the item (title, brand, size, condition, etc.)
 *   2. Fetches price comparables + AI valuation
 *   3. Generates a Depop-optimised description
 *   4. Creates a DRAFT listing in the database
 *
 * Returns a streaming NDJSON response so the client can show
 * real-time progress as each listing is created.
 */
import { NextRequest } from 'next/server'
import { uploadPhoto } from '@/lib/storage/photos'
import { groupPhotosByItem } from '@/lib/claude/group-photos'
import { identifyItemFromImage } from '@/lib/claude/identify'
import { searchComparables } from '@/lib/search/comparables'
import { synthesizeValuation } from '@/lib/claude/valuate'
import { prisma } from '@/lib/db/client'
import type { AIIdentifyResult } from '@/types'
import type { Prisma } from '@prisma/client'

export const maxDuration = 300

type ProgressEvent =
  | { type: 'upload'; uploaded: number; total: number }
  | { type: 'grouping' }
  | { type: 'listing'; index: number; total: number; title: string; id: string; price: number }
  | { type: 'error'; index: number; message: string }
  | { type: 'done'; created: number; total: number }

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: ProgressEvent) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      try {
        const form = await req.formData()
        const files = form.getAll('photos') as File[]

        if (!files.length) {
          send({ type: 'error', index: -1, message: 'No photos received' })
          controller.close()
          return
        }

        const MAX_FILES = 80
        const filesToProcess = files.slice(0, MAX_FILES)

        // ── 1. Upload all photos in parallel ──
        send({ type: 'upload', uploaded: 0, total: filesToProcess.length })

        let uploadedCount = 0
        const uploadResults = await Promise.allSettled(
          filesToProcess.map(async (file) => {
            const buffer = Buffer.from(await file.arrayBuffer())
            const url = await uploadPhoto(
              buffer,
              file.name || 'photo.jpg',
              file.type || 'image/jpeg'
            )
            uploadedCount++
            send({ type: 'upload', uploaded: uploadedCount, total: filesToProcess.length })
            return url
          })
        )

        const uploadedUrls: string[] = uploadResults
          .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
          .map((r) => r.value)

        if (!uploadedUrls.length) {
          send({ type: 'error', index: -1, message: 'All uploads failed' })
          controller.close()
          return
        }

        // ── 2. Group photos by item using Claude Vision ──
        send({ type: 'grouping' })
        const groups = await groupPhotosByItem(uploadedUrls)

        // ── 3. Process each group ──
        let created = 0
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i]
          // selectedIndices = best ≤4 photos chosen by Claude for quality/variety
          // photoIndices   = all photos of this item (kept on the listing)
          const selectedUrls = group.selectedIndices
            .map((idx) => uploadedUrls[idx])
            .filter(Boolean)
          const allGroupUrls = group.photoIndices
            .map((idx) => uploadedUrls[idx])
            .filter(Boolean)

          // Use selectedUrls for both identification and the listing (they're the best shots)
          const groupUrls = selectedUrls.length > 0 ? selectedUrls : allGroupUrls

          if (!groupUrls.length) continue

          try {
            // Identify item using the curated best photos
            const id = await identifyItemFromImage(groupUrls)

            // Get price suggestion (best-effort)
            const itemQuery = [id.brand, id.item_type, id.model_name]
              .filter(Boolean)
              .join(' ')
            let price = 25 // fallback
            try {
              const comps = await searchComparables(itemQuery)
              const valuation = await synthesizeValuation(
                itemQuery,
                id.condition ?? 'good',
                comps
              )
              if (valuation.mid > 0) price = Math.round(valuation.mid)
            } catch { /* use default */ }

            // Build description
            const description = buildDescription(id)

            const title =
              id.suggested_title ||
              [id.brand, id.item_type].filter(Boolean).join(' ') ||
              group.hint ||
              'New Item'

            // Create DRAFT listing
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

            created++
            send({
              type: 'listing',
              index: i,
              total: groups.length,
              title: listing.title,
              id: listing.id,
              price,
            })
          } catch (err) {
            send({
              type: 'error',
              index: i,
              message: err instanceof Error ? err.message : String(err),
            })
          }
        }

        send({ type: 'done', created, total: groups.length })
      } catch (err) {
        send({
          type: 'error',
          index: -1,
          message: err instanceof Error ? err.message : String(err),
        })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no', // disable Nginx buffering on Railway
    },
  })
}

function buildDescription(id: AIIdentifyResult): string {
  // First line optimised for Depop search (brand + item type in first 40 chars)
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
