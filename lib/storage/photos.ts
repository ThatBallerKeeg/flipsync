import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const BUCKET = 'listing-photos'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(url, key)
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

export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const supabase = getClient()

  // Fix EXIF rotation before upload so the image displays correctly everywhere
  const correctedBuffer = await fixOrientation(buffer)

  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  // Ensure bucket exists (no-op if already created)
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(safeName, correctedBuffer, { contentType, upsert: false })

  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(safeName)
  return data.publicUrl
}

export async function deletePhoto(url: string): Promise<void> {
  const supabase = getClient()
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const parts = url.split(marker)
  if (parts.length < 2) return
  const path = parts[1]
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
}
