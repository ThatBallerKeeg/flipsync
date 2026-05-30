import sharp from 'sharp'
import { prisma } from '@/lib/db/client'

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
 * Stores a photo in the PostgreSQL database and returns a relative URL
 * that can be served by the /api/photos/[id] route.
 *
 * Photos are served as /api/photos/[id] (relative URLs work in the browser;
 * server-side code that needs an absolute URL should prefix http://localhost:PORT).
 *
 * Previously used Supabase Storage, but the Supabase project became unreachable.
 * PostgreSQL storage works reliably through the connection pooler and eliminates
 * the external dependency.
 */
export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const correctedBuffer = await fixOrientation(buffer)
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')

  const photo = await prisma.photo.create({
    data: {
      filename: safeName,
      contentType,
      size: correctedBuffer.length,
      data: new Uint8Array(correctedBuffer),
    },
  })

  return `/api/photos/${photo.id}`
}

/**
 * Deletes a photo from the database given its /api/photos/[id] URL.
 * Also handles legacy Supabase Storage URLs (silently skipped if unreachable).
 * Best-effort — silently swallows errors.
 */
export async function deletePhoto(photoUrl: string): Promise<void> {
  // New DB-backed photos
  const dbMatch = photoUrl.match(/\/api\/photos\/([^/?#]+)/)
  if (dbMatch) {
    await prisma.photo.delete({ where: { id: dbMatch[1] } }).catch(() => {})
    return
  }

  // Legacy Supabase Storage URLs — best-effort delete (project may be unreachable)
  const BUCKET = 'listing-photos'
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return

  const marker = `/storage/v1/object/public/${BUCKET}/`
  const parts = photoUrl.split(marker)
  if (parts.length < 2) return
  const filePath = parts[1]

  await fetch(`${url.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${filePath}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${key}` },
  }).catch(() => {})
}
