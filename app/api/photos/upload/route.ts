import { NextRequest, NextResponse } from 'next/server'
import { uploadPhoto } from '@/lib/storage/photos'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = file.name || 'photo.jpg'
  const contentType = file.type || 'image/jpeg'

  try {
    const url = await uploadPhoto(buffer, filename, contentType)
    return NextResponse.json({ url })
  } catch (err) {
    console.error('Photo upload error:', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
