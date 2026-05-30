import Anthropic from '@anthropic-ai/sdk'

const VALID_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type ImageMediaType = typeof VALID_MEDIA_TYPES[number]

/**
 * Converts any photo URL to an Anthropic ImageBlockParam that Claude can read.
 *
 * - Absolute HTTPS URLs are passed by reference (Anthropic fetches them directly).
 * - Relative /api/photos/[id] URLs (DB-stored photos) are fetched from localhost
 *   and encoded as base64, because Anthropic's servers cannot reach private hosts.
 */
export async function toImageBlock(url: string): Promise<Anthropic.ImageBlockParam> {
  if (url.startsWith('https://') || url.startsWith('http://localhost')) {
    // External or explicit localhost URL — pass by reference when possible
    if (url.startsWith('https://')) {
      return { type: 'image', source: { type: 'url', url } }
    }
  }

  // Relative path or http://localhost — fetch bytes and send as base64
  const port = process.env.PORT || '3000'
  const absoluteUrl = url.startsWith('/')
    ? `http://localhost:${port}${url}`
    : url

  const resp = await fetch(absoluteUrl)
  if (!resp.ok) {
    throw new Error(`Failed to load photo for Claude: ${resp.status} ${absoluteUrl}`)
  }
  const buf = Buffer.from(await resp.arrayBuffer())
  const base64 = buf.toString('base64')
  const contentType = resp.headers.get('content-type') || 'image/jpeg'
  const mediaType: ImageMediaType =
    (VALID_MEDIA_TYPES.find((t) => contentType.startsWith(t)) as ImageMediaType | undefined)
    ?? 'image/jpeg'

  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: base64 },
  }
}
