import sharp from 'sharp'

const BUCKET = 'listing-photos'

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return { url: url.replace(/\/+$/, ''), key }
}

/**
 * Single sharp pipeline that:
 *   1. Reads the EXIF Orientation tag and BAKES the rotation into pixels
 *      (phone photos are often stored sideways with a "rotate me" flag — many
 *      viewers honour it but Depop's CDN does NOT, so the rotation has to be
 *      applied to the actual pixel data, not just the metadata).
 *   2. Resizes to max 1600px on the longest edge.
 *   3. Re-encodes as JPEG q78 — sharp's .jpeg() strips ALL metadata by default,
 *      which removes any residual EXIF Orientation tag.
 *
 * Order matters: .rotate() must come BEFORE .resize() so the resize uses the
 * upright dimensions (width/height swap on rotation), not the sensor-native ones.
 *
 * Result: a ~300 KB JPEG that displays correctly in EVERY viewer without
 * relying on the orientation tag.
 */
async function processPhotoForUpload(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer()
  } catch {
    return buffer   // non-image or corrupt — pass through as-is
  }
}

/**
 * Kept for backwards compatibility with callers that just want orientation fixing.
 * New code should use processPhotoForUpload() which does the full pipeline.
 */
export async function fixOrientation(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { failOn: 'none' })
      .rotate()
      .jpeg({ quality: 92 })  // strips EXIF, near-lossless
      .toBuffer()
  } catch {
    return buffer
  }
}

/**
 * Uploads a photo to Supabase Storage using the raw REST API instead of the
 * supabase-js SDK. The SDK wraps fetch errors in a generic "StorageUnknownError"
 * that hides the actual underlying network error (DNS failure, project paused,
 * cert issue, etc.). Raw fetch surfaces these clearly so we can fix the root cause.
 *
 * Photos are auto-rotated (EXIF) and compressed to ~300 KB before upload.
 */
export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const { url, key } = getSupabaseConfig()
  const processed = await processPhotoForUpload(buffer)
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const uploadUrl = `${url}/storage/v1/object/${BUCKET}/${safeName}`

  let res: Response
  try {
    res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'image/jpeg',
        'x-upsert': 'false',
        'cache-control': '3600',
      },
      body: new Uint8Array(processed),
    })
  } catch (e: unknown) {
    const err = e as Error & { cause?: unknown }
    const causeStr = err.cause
      ? (typeof err.cause === 'object'
          ? JSON.stringify(err.cause, Object.getOwnPropertyNames(err.cause))
          : String(err.cause))
      : 'no cause'
    console.error('[Supabase] Network fetch failed:', err.message, '| cause:', causeStr, '| url:', uploadUrl)
    throw new Error(`Supabase network error: ${err.message} (${causeStr})`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Supabase] Upload rejected: ${res.status} ${res.statusText} — ${body}`)
    throw new Error(`Supabase upload failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`)
  }

  return `${url}/storage/v1/object/public/${BUCKET}/${safeName}`
}

/**
 * Deletes a photo from Supabase Storage given its public URL.
 * Also handles legacy /api/photos/[id] DB URLs (no-op — DB photos expire naturally).
 * Best-effort — silently swallows errors.
 */
export async function deletePhoto(photoUrl: string): Promise<void> {
  // DB-backed photos (legacy) — nothing to delete in Storage
  if (photoUrl.startsWith('/api/photos/')) return

  let url: string, key: string
  try {
    const cfg = getSupabaseConfig()
    url = cfg.url
    key = cfg.key
  } catch {
    return
  }

  const marker = `/storage/v1/object/public/${BUCKET}/`
  const parts = photoUrl.split(marker)
  if (parts.length < 2) return
  const path = parts[1]

  await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${key}` },
  }).catch(() => {})
}
