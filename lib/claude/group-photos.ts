import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface PhotoGroup {
  photoIndices: number[]
  hint: string
}

/**
 * Uses Claude Vision to group a set of uploaded photo URLs by which
 * clothing item they show. Photos of the same item from different angles
 * are clustered together. Falls back to sequential chunks of 4 if Claude
 * can't parse a valid grouping.
 */
export async function groupPhotosByItem(urls: string[]): Promise<PhotoGroup[]> {
  if (urls.length === 0) return []

  // Single photo or ≤4 photos — treat as one item
  if (urls.length <= 4) {
    return [{ photoIndices: urls.map((_, i) => i), hint: 'item' }]
  }

  // Claude can handle up to 20 images in one call; process in batches if needed
  const BATCH = 20
  if (urls.length > BATCH) {
    const allGroups: PhotoGroup[] = []
    let offset = 0
    for (let i = 0; i < urls.length; i += BATCH) {
      const batch = urls.slice(i, i + BATCH)
      const batchGroups = await groupBatch(batch)
      // Adjust indices to be relative to the full array
      for (const g of batchGroups) {
        allGroups.push({
          photoIndices: g.photoIndices.map((idx) => idx + offset),
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
  const imageBlocks: Anthropic.ImageBlockParam[] = urls.map((url) => ({
    type: 'image',
    source: { type: 'url', url },
  }))

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: `These are ${urls.length} product photos (indices 0–${urls.length - 1}). Group them by clothing item — multiple angles of the SAME item belong in the same group. Each item may have 1–6 photos.

Return ONLY a JSON array, no explanation:
[{"indices":[0,1,2],"hint":"navy hoodie"},{"indices":[3,4],"hint":"black cargo pants"}]`,
            },
          ],
        },
      ],
    })

    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return fallbackChunks(urls.length)

    const parsed = JSON.parse(match[0]) as Array<{ indices: number[]; hint: string }>
    if (!Array.isArray(parsed) || parsed.length === 0) return fallbackChunks(urls.length)

    return parsed.map((g) => ({
      photoIndices: (g.indices ?? []).filter((i) => typeof i === 'number' && i < urls.length),
      hint: g.hint ?? 'item',
    })).filter((g) => g.photoIndices.length > 0)
  } catch {
    return fallbackChunks(urls.length)
  }
}

function fallbackChunks(count: number): PhotoGroup[] {
  const groups: PhotoGroup[] = []
  for (let i = 0; i < count; i += 4) {
    groups.push({
      photoIndices: Array.from({ length: Math.min(4, count - i) }, (_, j) => i + j),
      hint: `item ${groups.length + 1}`,
    })
  }
  return groups
}
