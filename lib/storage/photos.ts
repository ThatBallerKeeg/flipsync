import { createClient } from '@supabase/supabase-js'

const BUCKET = 'listing-photos'

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(url, key)
}

export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const supabase = getClient()
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  // Ensure bucket exists (no-op if already created)
  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {})

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(safeName, buffer, { contentType, upsert: false })

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
