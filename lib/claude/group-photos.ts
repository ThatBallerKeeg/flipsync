import Anthropic from '@anthropic-ai/sdk'
import { withRetry } from './retry'
import { toImageBlock } from './image-blocks'
import { parseClaudeJson } from './parse-json'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PhotoGroup {
  /** All photo indices belonging to this item */
  photoIndices: number[]
  /**
   * Selected indices for the listing, in display order:
   *   [0] cover (top-down/laid-flat) → [1] side/front/back → flaws → tag → measurements
   * Capped at 6. Browser automation uses the first 4 for Depop upload.
   */
  selectedIndices: number[]
  hint: string
}

/**
 * Uses Claude Vision to:
 *   1. Group a set of uploaded photo URLs by which clothing item they show
 *   2. Within each group, ORDER the best ≤6 photos in display priority:
 *      top-down (cover) → side angle → flaws → brand/size tag → measurements
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

═══ STEP 1: GROUP by physical item ═══
- Each photo shows ONE physical item.
- Only group photos together if you are CONFIDENT they show the EXACT SAME physical object (same garment, same wear marks, same exact fabric/print/details).
- Two shirts of the same brand or style but with different graphics, colors, sizes, or visible details are DIFFERENT items → separate groups.
- When in doubt → SPLIT into separate groups. False merges are worse than false splits.
- Typical: each item has 2–6 photos (overhead, side, tag, measurements). Groups of 8+ photos for one item are rare.

═══ STEP 2: ORDER the "selected" array in STRICT priority order ═══
Position 0 (the COVER photo):
  → Top-down / laid-flat / overhead shot showing the full item from above.
  → If no overhead shot exists, use the cleanest full-item front view.

Position 1:
  → A side, front, back, or 3/4 angle clearly showing the item's silhouette.

Next (one or more):
  → FLAW close-ups: visible damage, stains, holes, fading, pilling. One per flaw.

Next:
  → Brand/size/care TAG close-up.

Last (one or more):
  → MEASUREMENT photos (tape-measure shots). Include EVERY measurement shot if
    multiple exist for different parts (chest, length, sleeve, waist, inseam, etc.).
    Do NOT dedupe these — different measurements look similar but are distinct.

Skip a category if no matching photo exists in this item's group.
Cap "selected" at 6 photos. If you must drop something, drop in this order:
extra full-item angles → tag → measurements (keep at least one measurement if any exist).

═══ Return ONLY a JSON array (no prose, no markdown fences) ═══
[
  {"indices":[0,1,2,3],"selected":[2,0,1,3],"hint":"navy Carhartt hoodie"},
  {"indices":[4,5,6,7,8],"selected":[4,5,7,6,8],"hint":"black cargo pants"},
  {"indices":[9],"selected":[9],"hint":"red graphic tee"}
]

EVERY index 0–${urls.length - 1} must appear in exactly one group's "indices".
"selected" must be a subset of "indices", in the priority order above, max 6.`,
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
        // Validate selected: must be a subset of allIndices, preserve Claude's ordering, cap at 6.
        // Dedupe while preserving first occurrence so duplicates from a noisy response don't
        // push a measurement off the end of the list.
        const seen = new Set<number>()
        const rawSelected = (g.selected ?? allIndices).filter((i) => {
          if (typeof i !== 'number' || !allIndices.includes(i) || seen.has(i)) return false
          seen.add(i)
          return true
        })
        const selectedIndices =
          rawSelected.length > 0 ? rawSelected.slice(0, 6) : allIndices.slice(0, 6)

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
