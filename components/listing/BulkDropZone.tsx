'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, Loader2, Upload, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ProgressItem {
  type: 'listing' | 'error'
  title?: string
  id?: string
  price?: number
  message?: string
  index: number
}

interface BulkDropZoneProps {
  onComplete: (listingIds: string[]) => void
}

export function BulkDropZone({ onComplete }: BulkDropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'grouping' | 'building' | 'done'>('idle')
  const [uploadProgress, setUploadProgress] = useState({ uploaded: 0, total: 0 })
  const [buildProgress, setBuildProgress] = useState({ current: 0, total: 0 })
  const [items, setItems] = useState<ProgressItem[]>([])
  const [createdIds, setCreatedIds] = useState<string[]>([])
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Detect drag-over the entire window
  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragCounter.current++
      setIsDraggingOver(true)
    }
    function onDragLeave() {
      dragCounter.current--
      if (dragCounter.current === 0) setIsDraggingOver(false)
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault()
    }
    function onDrop(e: DragEvent) {
      e.preventDefault()
      dragCounter.current = 0
      setIsDraggingOver(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/')
      )
      if (files.length) processFiles(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    setIsOpen(true)
    setPhase('uploading')
    setItems([])
    setCreatedIds([])
    setUploadProgress({ uploaded: 0, total: files.length })
    setBuildProgress({ current: 0, total: 0 })

    // Use a local array (not state) to avoid stale-closure issues when calling onComplete
    const localCreatedIds: string[] = []

    const form = new FormData()
    for (const f of files) form.append('photos', f)

    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string
      if (type === 'upload') {
        setUploadProgress({ uploaded: event.uploaded as number, total: event.total as number })
      } else if (type === 'grouping') {
        setPhase('grouping')
      } else if (type === 'listing') {
        setPhase('building')
        setBuildProgress({ current: (event.index as number) + 1, total: event.total as number })
        const id = event.id as string
        localCreatedIds.push(id)
        setCreatedIds([...localCreatedIds])
        setItems((prev) => [
          ...prev,
          { type: 'listing', index: event.index as number, title: event.title as string, id, price: event.price as number },
        ])
      } else if (type === 'error' && (event.index as number) >= 0) {
        setItems((prev) => [
          ...prev,
          { type: 'error', index: event.index as number, message: event.message as string },
        ])
      } else if (type === 'done') {
        setPhase('done')
        onComplete(localCreatedIds)
      }
    }

    try {
      const res = await fetch('/api/listings/bulk-build', { method: 'POST', body: form })
      if (!res.ok || !res.body) {
        throw new Error(`Server error: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handleEvent(JSON.parse(line))
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setItems((prev) => [
        ...prev,
        { type: 'error', index: -1, message: err instanceof Error ? err.message : String(err) },
      ])
      setPhase('done')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onComplete])

  function handleClose() {
    if (phase === 'done' || phase === 'idle') {
      setIsOpen(false)
      setPhase('idle')
      setItems([])
    }
  }

  const phaseLabel = {
    idle: '',
    uploading: `Uploading photos… (${uploadProgress.uploaded}/${uploadProgress.total})`,
    grouping: 'Grouping photos by item…',
    building: `Building listings… (${buildProgress.current}/${buildProgress.total})`,
    done: `Done — ${createdIds.length} draft listing${createdIds.length !== 1 ? 's' : ''} created`,
  }[phase]

  return (
    <>
      {/* Full-window drag overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-background px-12 py-10 shadow-xl">
            <Zap className="h-10 w-10 text-primary" />
            <p className="text-lg font-semibold text-primary">Drop photos to build listings</p>
            <p className="text-sm text-muted-foreground">FlipSync will auto-group and create drafts</p>
          </div>
        </div>
      )}

      {/* Click-to-upload trigger */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
      >
        <Upload className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">Drop photos anywhere</span> or click to select —
          FlipSync will auto-build draft listings for each item
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (files.length) processFiles(files)
          e.target.value = ''
        }}
      />

      {/* Progress modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="relative w-full max-w-md rounded-2xl border bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div className="flex items-center gap-2">
                {phase === 'done' ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="font-semibold text-sm">
                  {phase === 'done' ? 'Build complete' : 'Building listings…'}
                </span>
              </div>
              {phase === 'done' && (
                <button onClick={handleClose} className="rounded p-1 hover:bg-muted">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            {/* Phase label */}
            <div className="px-5 py-3 text-sm text-muted-foreground border-b bg-muted/30">
              {phaseLabel}
            </div>

            {/* Listing results */}
            {items.length > 0 && (
              <div className="max-h-64 overflow-y-auto divide-y">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    {item.type === 'listing' ? (
                      <>
                        <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground">${item.price} · Draft created</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <X className="h-4 w-4 shrink-0 text-destructive" />
                        <p className="text-sm text-muted-foreground truncate">{item.message}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            {phase === 'done' && (
              <div className="flex justify-end gap-2 border-t px-5 py-4">
                <Button variant="outline" size="sm" onClick={handleClose}>Close</Button>
                <Button size="sm" asChild>
                  <a href="/listings?status=DRAFT">View Drafts →</a>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
