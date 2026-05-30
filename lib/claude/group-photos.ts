import Anthropic from '@anthropic-ai/sdk'
import { withRetry } from './retry'
import { toImageBlock } from './image-blocks'
import { parseClaudeJson } from './parse-json'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/** Photo role classification used to order photos in the listing. */
export type PhotoRole = 'cover' | 'side' | 'flaw' | 'tag' | 'measurement' | 'other'

/** Fixed sort priority. Lower number = earlier in the listing. */
const ROLE_PRIORITY: Record<PhotoRole, number> = {
  cover:       0,
  side:        1,
  flaw:        2,
  tag:         3,
  measurement: 4,
  other:       5,
}

export interface PhotoGroup {
  /** All photo indices belonging to this item */
  photoIndices: number[]
  /**
   * Selected indices for the listing, in display order:
   *   cover (top-down/laid-flat) → side/front/back → flaws (if any)
   *   → tag (if visible) → all measurement shots
   * Order is enforced programmatically from the per-photo role classification,
   * NOT trusted from Claude's output position.
   */
  selectedIndices: number[]
  hint: string
}

/**
 * Uses Claude Vision to:
 *   1. Group a set of uploaded photo URLs by which clothing item they show
 *   2. Within each group, ORDER all relevant photos in display priority:
 *      top-down (cover) → side angle → flaws (if any) → brand/size tag → all measurements
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
              text: `These are ${urls.length} resale product photos, indices 0–${urls.length - 1}.

═══ STEP 1: GROUP by physical item ═══
Each photo shows ONE physical item.
- Group photos together ONLY if you are CONFIDENT they show the EXACT SAME physical object (same garment, same wear marks, same exact fabric/print/details).
- Two items of the same brand or style with different graphics, colors, sizes, or details are DIFFERENT items → separate groups.
- When in doubt → SPLIT. False merges are far worse than false splits.

═══ STEP 2: For each photo in a group, assign a ROLE ═══

ROLES (use EXACTLY these strings):
- "cover"       — TOP-DOWN / LAID-FLAT / OVERHEAD shot of the full item, viewed from directly above (item laid on a surface). This is the most important — it becomes the listing's main photo. Pick AT MOST ONE per group.
- "side"        — front, back, side, 3/4 angle, or any non-overhead full-item view.
- "flaw"        — close-up of damage, stain, hole, tear, fading, pilling, missing button, etc. ONLY use if the photo actually shows a visible defect.
- "tag"         — close-up of brand tag, size tag, care label, or interior label.
- "measurement" — photo featuring a tape measure / ruler measuring a dimension (chest, length, sleeve, waist, inseam, etc.). Use this role for EVERY measurement shot, even if they look similar — they show different dimensions.
- "other"       — anything else that should still be included but doesn't fit the above.

ROLE RULES:
- If no photo is clearly top-down, pick the cleanest front-on full-item shot as "cover" and tag the rest as "side".
- Every photo in a group MUST get a role.
- Do NOT classify a photo as "flaw" unless there's actually visible damage. Most items have NO flaw photos.

═══ Return ONLY a JSON array (no prose, no markdown fences) ═══
[
  {"hint":"navy Carhartt hoodie","photos":[{"i":2,"role":"cover"},{"i":0,"role":"side"},{"i":1,"role":"tag"}]},
  {"hint":"black cargo pants","photos":[{"i":3,"role":"cover"},{"i":4,"role":"side"},{"i":5,"role":"flaw"},{"i":6,"role":"tag"},{"i":7,"role":"measurement"},{"i":8,"role":"measurement"}]},
  {"hint":"red graphic tee","photos":[{"i":9,"role":"cover"}]}
]

EVERY index 0–${urls.length - 1} must appear in exactly one group's "photos".`,
            },
          ],
        },
      ],
    }), 'group')

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    const parsed = parseClaudeJson<Array<{
      hint?: string
      photos: Array<{ i: number; role: string }>
    }>>(text, 'array')
    if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`[group] Unparseable response, falling back to chunks: ${text.slice(0, 120)}`)
      return fallbackChunks(urls.length)
    }

    return parsed
      .map((g) => {
        // Validate & dedupe — keep first occurrence of each index
        const seen = new Set<number>()
        const photos = (g.photos ?? []).filter((p) => {
          if (!p || typeof p.i !== 'number' || p.i < 0 || p.i >= urls.length) return false
          if (seen.has(p.i)) return false
          seen.add(p.i)
          return true
        })

        const isRole = (r: string): r is PhotoRole =>
          r === 'cover' || r === 'side' || r === 'flaw' || r === 'tag' || r === 'measurement' || r === 'other'

        // Ensure EXACTLY ONE cover. If Claude picked multiple, demote extras to "side".
        // If Claude picked none, promote the first "side" (or first photo) to cover.
        let coverSeen = false
        const typed = photos.map((p) => {
          const role: PhotoRole = isRole(p.role) ? p.role : 'other'
          if (role === 'cover') {
            if (coverSeen) return { i: p.i, role: 'side' as PhotoRole }
            coverSeen = true
          }
          return { i: p.i, role }
        })
        if (!coverSeen && typed.length > 0) {
          const promoteIdx = typed.findIndex((p) => p.role === 'side') !== -1
            ? typed.findIndex((p) => p.role === 'side')
            : 0
          typed[promoteIdx] = { ...typed[promoteIdx], role: 'cover' }
        }

        // Sort: cover → side → flaw → tag → measurement → other.
        // Within each role, preserve Claude's original output order (stable sort).
        const sorted = typed
          .map((p, originalPos) => ({ ...p, originalPos }))
          .sort((a, b) => {
            const diff = ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]
            return diff !== 0 ? diff : a.originalPos - b.originalPos
          })

        const allIndices = sorted.map((p) => p.i)
        return {
          photoIndices: allIndices,
          selectedIndices: allIndices,  // already ordered correctly
          hint: g.hint ?? 'item',
        }
      })
      .filter((g) => g.photoIndices.length > 0)
  } catch (e) {
    console.warn('[group] Exception during groupBatch, falling back to chunks:', e instanceof Error ? e.message : e)
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
