'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, Loader2, Upload, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface JobResult {
  ok: boolean
  id?: string
  title?: string
  price?: number
  error?: string
  index: number
}

interface JobState {
  status: string    // "processing" | "done" | "error"
  phase: string     // "grouping" | "building" | "done"
  totalPhotos: number
  totalGroups: number
  created: number
  results: JobResult[]
  error?: string
}

interface BulkDropZoneProps {
  onComplete: (listingIds: string[]) => void
}

const POLL_INTERVAL = 2500 // ms

export function BulkDropZone({ onComplete }: BulkDropZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)       // uploading FormData to server
  const [sendProgress, setSendProgress] = useState(0)     // 0-100 XHR upload progress
  const [sendTotal, setSendTotal] = useState(0)           // total photos being sent
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])

  // ── Polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return
    if (pollRef.current) clearInterval(pollRef.current)

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/listings/bulk-build/${jobId}`)
        if (!res.ok) return
        const data: JobState = await res.json()
        setJob(data)

        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          if (data.status === 'done') {
            const ids = data.results.filter((r) => r.ok).map((r) => r.id!)
            onCompleteRef.current(ids)
          }
        }
      } catch { /* network blip — keep polling */ }
    }, POLL_INTERVAL)

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [jobId])

  // ── Drag detection ───────────────────────────────────────────────────────
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
    function onDragOver(e: DragEvent) { e.preventDefault() }
    function onDrop(e: DragEvent) {
      e.preventDefault()
      dragCounter.current = 0
      setIsDraggingOver(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
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

  // ── Send photos + start job ──────────────────────────────────────────────
  const processFiles = useCallback(async (files: File[]) => {
    setIsOpen(true)
    setIsSending(true)
    setSendProgress(0)
    setSendTotal(files.length)
    setJob(null)
    setJobId(null)

    const form = new FormData()
    for (const f of files) form.append('photos', f)

    try {
      // Use XHR so we can track upload progress
      const id = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/listings/bulk-build')
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setSendProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText).jobId) }
            catch { reject(new Error('Invalid server response')) }
          } else {
            try {
              const body = JSON.parse(xhr.responseText)
              reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`))
            }
          }
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(form)
      })

      setIsSending(false)
      setJobId(id)
      // Polling kicks in via the useEffect above
    } catch (err) {
      setIsSending(false)
      setJob({
        status: 'error',
        phase: 'done',
        totalPhotos: files.length,
        totalGroups: 0,
        created: 0,
        results: [],
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  // ── Derived state ────────────────────────────────────────────────────────
  const isDone = job?.status === 'done' || job?.status === 'error'

  function phaseLabel() {
    if (isSending) {
      return sendProgress < 100
        ? `Uploading ${sendTotal} photo${sendTotal !== 1 ? 's' : ''}… ${sendProgress}%`
        : `Processing upload…`
    }
    if (!job) return 'Starting…'
    if (job.phase === 'grouping') return `Grouping ${job.totalPhotos} photos by item…`
    if (job.phase === 'building') {
      const pct = job.totalGroups > 0 ? Math.round((job.created / job.totalGroups) * 100) : 0
      return `Building listings… ${job.created}/${job.totalGroups} (${pct}%)`
    }
    if (job.status === 'done') return `Done — ${job.created} draft listing${job.created !== 1 ? 's' : ''} created`
    if (job.status === 'error') return `Error: ${job.error ?? 'unknown'}`
    return 'Working…'
  }

  function handleClose() {
    if (isDone || (!isSending && !jobId)) {
      setIsOpen(false)
      setJob(null)
      setJobId(null)
      setSendProgress(0)
    }
  }

  const successItems = job?.results.filter((r) => r.ok) ?? []
  const errorItems = job?.results.filter((r) => !r.ok) ?? []

  return (
    <>
      {/* Full-window drag overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-background px-12 py-10 shadow-xl">
            <Zap className="h-10 w-10 text-primary" />
            <p className="text-lg font-semibold text-primary">Drop photos to build listings</p>
            <p className="text-sm text-muted-foreground">FlipSync will auto-group and create drafts — you can close this tab while it runs</p>
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
          FlipSync auto-builds drafts, runs in background even if you close this tab
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
                {isDone ? (
                  <CheckCircle className={`h-5 w-5 ${job?.status === 'error' ? 'text-destructive' : 'text-green-500'}`} />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="font-semibold text-sm">
                  {isDone ? (job?.status === 'error' ? 'Build failed' : 'Build complete') : 'Building listings…'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!isDone && (
                  <span className="text-xs text-muted-foreground">Safe to close this tab</span>
                )}
                {isDone && (
                  <button onClick={handleClose} className="rounded p-1 hover:bg-muted">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Phase label + upload progress bar */}
            <div className="px-5 py-3 border-b bg-muted/30 space-y-2">
              <p className="text-sm text-muted-foreground">{phaseLabel()}</p>
              {isSending && (
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${sendProgress}%` }}
                  />
                </div>
              )}
              {!isSending && job && job.totalGroups > 0 && job.phase === 'building' && (
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.round((job.created / job.totalGroups) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Listing results */}
            {(successItems.length > 0 || errorItems.length > 0) && (
              <div className="max-h-64 overflow-y-auto divide-y">
                {successItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">${item.price} · Draft created</p>
                    </div>
                  </div>
                ))}
                {errorItems.map((item, i) => (
                  <div key={`e${i}`} className="flex items-center gap-3 px-5 py-3">
                    <X className="h-4 w-4 shrink-0 text-destructive" />
                    <p className="text-sm text-muted-foreground truncate">{item.error}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            {isDone && (
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
