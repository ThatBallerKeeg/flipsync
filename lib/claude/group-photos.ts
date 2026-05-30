import Anthropic from '@anthropic-ai/sdk'
import { withRetry } from './retry'
import { toImageBlock } from './image-blocks'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PhotoGroup {
  /** All photo indices belonging to this item */
  photoIndices: number[]
  /** Best ≤4 indices to use for the listing and AI identification */
  selectedIndices: number[]
  hint: string
}

/**
 * Uses Claude Vision to:
 *   1. Group a set of uploaded photo URLs by which clothing item they show
 *   2. Within each group, select the best ≤4 photos based on quality
 *      (lighting, focus, background, angle variety — avoids near-duplicates)
 *
 * Falls back to sequential chunks of 4 if Claude returns an unparseable response.
 */
export async function groupPhotosByItem(urls: string[]): Promise<PhotoGroup[]> {
  if (urls.length === 0) return []

  // ≤4 photos — one item, use all of them
  if (urls.length <= 4) {
    const indices = urls.map((_, i) => i)
    return [{ photoIndices: indices, selectedIndices: indices, hint: 'item' }]
  }

  // Claude handles up to 20 images per call; batch larger sets
  const BATCH = 20
  if (urls.length > BATCH) {
    const allGroups: PhotoGroup[] = []
    let offset = 0
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH)
      const batchGroups = await groupBatch(batch)
      for (const g of batchGroups) {
        allGroups.push({
          photoIndices:   g.photoIndices.map((idx) => idx + offset),
          selectedIndices: g.selectedIndices.map((idx) => idx + offset),
          hint: g.hint,
        })
      }
      offset += batch.length
    }
    return allGroups
  }

  return groupBatch(urls)
}

async function groupBatch(urls: string[]): Promise<PhotoGroup[]> {
  // Load all photos as image blocks (base64 for local DB-stored photos, URL for external)
  const imageBlocks: Anthropic.ImageBlockParam[] = await Promise.all(urls.map(toImageBlock))

  try {
    const response = await withRetry(() => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `These are ${urls.length} resale product photos (indices 0–${urls.length - 1}). Do two things:

1. GROUP by clothing item — photos of the same item from different angles belong together.

2. SELECT the best ≤4 photos per group for a Depop listing. Prefer photos with:
   - Good, even lighting (not dark, shadowy, or blown-out)
   - Sharp focus (not blurry)
   - Clean or neutral background
   - Varied angles (ideally: front, back, tag/label, detail shot)
   - Avoid picking near-identical shots — diversity over quantity

Return ONLY a JSON array, no explanation:
[
  {"indices":[0,1,2,3,4],"selected":[0,2,4],"hint":"navy hoodie"},
  {"indices":[5,6],"selected":[5,6],"hint":"black cargo pants"}
]

"indices" = ALL photos of that item (every index that belongs to it)
"selected" = the best ones to use, max 4, must be a subset of "indices"`,
            },
          ],
        },
      ],
    }), 'group')

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return fallbackChunks(urls.length)

    const parsed = JSON.parse(match[0]) as Array<{
      indices: number[]
      selected?: number[]
      hint: string
    }>
    if (!Array.isArray(parsed) || parsed.length === 0) return fallbackChunks(urls.length)

    return parsed
      .map((g) => {
        const allIndices = (g.indices ?? []).filter(
          (i) => typeof i === 'number' && i >= 0 && i < urls.length
        )
        // Validate selected: must be a subset of allIndices, max 4
        const rawSelected = (g.selected ?? allIndices).filter(
          (i) => typeof i === 'number' && allIndices.includes(i)
        )
        const selectedIndices =
          rawSelected.length > 0 ? rawSelected.slice(0, 4) : allIndices.slice(0, 4)

        return {
          photoIndices: allIndices,
          selectedIndices,
          hint: g.hint ?? 'item',
        }
      })
      .filter((g) => g.photoIndices.length > 0)
  } catch {
    return fallbackChunks(urls.length)
  }
}

function fallbackChunks(count: number): PhotoGroup[] {
  const groups: PhotoGroup[] = []
  for (let i = 0; i < count; i += 4) {
    const indices = Array.from({ length: Math.min(4, count - i) }, (_, j) => i + j)
    groups.push({ photoIndices: indices, selectedIndices: indices, hint: `item ${groups.length + 1}` })
  }
  return groups
}
