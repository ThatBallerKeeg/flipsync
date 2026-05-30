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
 * Auto-rotate a photo buffer using its EXIF orientation tag, then strip the tag.
 * Phone photos are frequently stored sideways with an EXIF flag saying "rotate me"
 * — many viewers honour the flag but Depop's CDN does not, so we bake the rotation
 * into the pixels before upload.
 */
export async function fixOrientation(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate()          // reads EXIF Orientation, rotates pixels, removes the tag
      .withMetadata({ orientation: undefined })  // strip residual orientation
      .toBuffer()
  } catch {
    return buffer        // non-image or corrupt — return as-is
  }
}

/**
 * Uploads a photo to Supabase Storage using the raw REST API instead of the
 * supabase-js SDK. The SDK wraps fetch errors in a generic "StorageUnknownError"
 * that hides the actual underlying network error (DNS failure, project paused,
 * cert issue, etc.). Raw fetch surfaces these clearly so we can fix the root cause.
 */
export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const { url, key } = getSupabaseConfig()
  const correctedBuffer = await fixOrientation(buffer)
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const uploadUrl = `${url}/storage/v1/object/${BUCKET}/${safeName}`

  let res: Response
  try {
    res = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
        'cache-control': '3600',
      },
      body: new Uint8Array(correctedBuffer),
    })
  } catch (e: unknown) {
    // Raw network errors (TypeError: fetch failed) — surface the underlying cause
    const err = e as Error & { cause?: unknown; code?: string }
    const causeStr = err.cause
      ? (typeof err.cause === 'object' ? JSON.stringify(err.cause, Object.getOwnPropertyNames(err.cause)) : String(err.cause))
      : 'no cause'
    console.error('[Supabase] Network fetch failed:', err.message, '| cause:', causeStr, '| url:', uploadUrl)
    throw new Error(`Supabase network error: ${err.message} (${causeStr})`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[Supabase] Upload rejected: ${res.status} ${res.statusText} — ${body}`)
    throw new Error(`Supabase upload failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`)
  }

  // Public URL pattern matches what supabase-js getPublicUrl returns
  return `${url}/storage/v1/object/public/${BUCKET}/${safeName}`
}

/**
 * Deletes a photo from Supabase Storage given its public URL.
 * Best-effort — silently swallows errors.
 */
export async function deletePhoto(photoUrl: string): Promise<void> {
  const { url, key } = getSupabaseConfig()
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const parts = photoUrl.split(marker)
  if (parts.length < 2) return
  const path = parts[1]

  await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${key}` },
  }).catch(() => {})
}
