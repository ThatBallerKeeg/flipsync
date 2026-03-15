'use client'
import { useCallback, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, X, Loader2, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  photos: string[]
  onChange: (photos: string[]) => void
  onFirstPhotoUploaded?: (url: string) => void
  maxPhotos?: number
}

export function PhotoUploader({ photos, onChange, onFirstPhotoUploaded, maxPhotos = 10 }: Props) {
  const [uploading, setUploading] = useState(false)
  const dragIndex = useRef<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/photos/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error('Upload failed')
    const { url } = await res.json()
    return url
  }, [])

  const onDrop = useCallback(
    async (files: File[]) => {
      if (photos.length >= maxPhotos) return
      setUploading(true)
      try {
        const toUpload = files.slice(0, maxPhotos - photos.length)
        const urls = await Promise.all(toUpload.map(uploadFile))
        const newPhotos = [...photos, ...urls]
        onChange(newPhotos)
        if (photos.length === 0 && urls[0]) {
          onFirstPhotoUploaded?.(urls[0])
        }
      } finally {
        setUploading(false)
      }
    },
    [photos, maxPhotos, onChange, onFirstPhotoUploaded, uploadFile]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: maxPhotos - photos.length,
    disabled: uploading || photos.length >= maxPhotos,
  })

  const removePhoto = (index: number) => {
    onChange(photos.filter((_, i) => i !== index))
  }

  const handleDragStart = (index: number) => {
    dragIndex.current = index
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    dragOverIndex.current = index
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const from = dragIndex.current
    const to = dragOverIndex.current
    if (from === null || to === null || from === to) return
    const reordered = [...photos]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    onChange(reordered)
    dragIndex.current = null
    dragOverIndex.current = null
  }

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">Drag to reorder · First photo is the cover</p>
          <div className="grid grid-cols-5 gap-2">
            {photos.map((url, i) => (
              <div
                key={url}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={handleDrop}
                className="group relative aspect-square rounded-md overflow-hidden bg-muted cursor-grab active:cursor-grabbing"
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute left-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="h-4 w-4 text-white drop-shadow" />
                </div>
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-xs text-white">Cover</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {photos.length < maxPhotos && (
        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
            isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50',
            (uploading || photos.length >= maxPhotos) && 'cursor-not-allowed opacity-50'
          )}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {uploading ? 'Uploading...' : isDragActive ? 'Drop photos here' : 'Drag & drop photos here, or click to select'}
          </p>
          <p className="text-xs text-muted-foreground/60">{photos.length}/{maxPhotos} photos</p>
        </div>
      )}
    </div>
  )
}
