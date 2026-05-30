import Anthropic from '@anthropic-ai/sdk'
import { withRetry } from './retry'
import { toImageBlock } from './image-blocks'
import { parseClaudeJson } from './parse-json'

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

  // Batch size 12 — Sonnet is much more accurate at distinguishing items
  // when given fewer images per call (Haiku at 20 over-groups visually similar items).
  const BATCH = 12
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
      // Sonnet — Haiku consistently merges visually-similar but distinct items into one group
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `These are ${urls.length} resale product photos (indices 0–${urls.length - 1}).

GROUPING RULES — read carefully:
- Each photo shows ONE physical item.
- Only group photos together if you are CONFIDENT they show the EXACT SAME physical object (same garment, same wear marks, same exact fabric/print/details).
- Two shirts of the same brand or style but with different graphics, colors, sizes, or visible details are DIFFERENT items → separate groups.
- When in doubt → SPLIT into separate groups. False merges (different items grouped together) are worse than false splits.
- Typical: each item has 1–4 photos (front, back, tag/label, detail). Groups of 6+ photos for one item are very rare.

Then SELECT the best ≤4 photos per group, preferring: even lighting, sharp focus, clean background, varied angles, no near-duplicates.

Return ONLY a JSON array (no prose, no markdown fences):
[
  {"indices":[0,1,2],"selected":[0,1,2],"hint":"navy Carhartt hoodie"},
  {"indices":[3,4],"selected":[3,4],"hint":"black cargo pants"},
  {"indices":[5],"selected":[5],"hint":"red graphic tee"}
]

EVERY index 0–${urls.length - 1} must appear in exactly one group's "indices".
"selected" must be a subset of "indices", max 4.`,
            },
          ],
        },
      ],
    }), 'group')

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    const parsed = parseClaudeJson<Array<{
      indices: number[]
      selected?: number[]
      hint: string
    }>>(text, 'array')
    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`[group] Unparseable response, falling back to chunks: ${text.slice(0, 120)}`)
      return fallbackChunks(urls.length)
    }

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
