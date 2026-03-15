'use client'
import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { RefreshCw, Loader2 } from 'lucide-react'
import { AIIdentifyResult, ComparableListing } from '@/types'

interface Props {
  depopDescription: string
  onDepopChange: (v: string) => void
  itemData?: AIIdentifyResult
  comparables?: ComparableListing[]
}

export function DescriptionEditor({ depopDescription, onDepopChange, itemData, comparables }: Props) {
  const [regenerating, setRegenerating] = useState(false)

  const regenerate = async () => {
    if (!itemData) return
    setRegenerating(true)
    try {
      const res = await fetch('/api/ai/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemData, comparables: comparables ?? [] }),
      })
      const data = await res.json()
      if (data.depop) onDepopChange(data.depop)
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#FF2300] px-2 py-0.5 text-xs text-white font-bold">Depop</span>
          <span className="text-sm font-medium">Description</span>
        </div>
        <Button variant="ghost" size="sm" onClick={regenerate} disabled={!itemData || regenerating}>
          {regenerating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Regenerate
        </Button>
      </div>
      <Textarea
        value={depopDescription}
        onChange={(e) => onDepopChange(e.target.value)}
        placeholder="Casual description with hashtags will be generated automatically..."
        rows={10}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">Casual tone · 2-3 paragraphs · Ends with hashtags</p>
    </div>
  )
}
