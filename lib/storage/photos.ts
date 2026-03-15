import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'

const UPLOADS_DIR = join(process.cwd(), 'public', 'uploads')

export async function uploadPhoto(
  buffer: Buffer,
  filename: string,
  _contentType: string
): Promise<string> {
  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const filePath = join(UPLOADS_DIR, safeName)
  await writeFile(filePath, buffer)
  return `/uploads/${safeName}`
}

export async function deletePhoto(url: string): Promise<void> {
  const filename = url.split('/uploads/')[1]
  if (!filename) return
  const filePath = join(UPLOADS_DIR, filename)
  await unlink(filePath).catch(() => {})
}
