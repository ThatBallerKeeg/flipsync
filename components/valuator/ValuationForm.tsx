'use client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, Search, Camera } from 'lucide-react'
import { ValuationResult } from '@/types'
import { uploadPhoto } from '@/lib/storage/photos'

const schema = z.object({
  itemQuery: z.string().min(2, 'Enter an item name'),
  condition: z.enum(['new_with_tags', 'excellent', 'good', 'fair', 'poor']),
})

type FormData = z.infer<typeof schema>

interface Props { onResult: (r: ValuationResult) => void }

export function ValuationForm({ onResult }: Props) {
  const [mode, setMode] = useState<'text' | 'photo'>('text')
  const [loading, setLoading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string>('')

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { condition: 'good' },
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const res = await fetch('/api/valuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, imageUrl: photoUrl || undefined }),
      })
      const result = await res.json()
      onResult(result)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex rounded-lg border p-1 gap-1">
          <button
            onClick={() => setMode('text')}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === 'text' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Search className="h-3.5 w-3.5" />Text Search
          </button>
          <button
            onClick={() => setMode('photo')}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === 'photo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Camera className="h-3.5 w-3.5" />Photo Mode
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {mode === 'text' ? (
            <div>
              <Label htmlFor="itemQuery">Item Name</Label>
              <Input id="itemQuery" placeholder="e.g. Nike Air Max 90 UK9" {...register('itemQuery')} className="mt-1" />
              {errors.itemQuery && <p className="mt-1 text-xs text-destructive">{errors.itemQuery.message}</p>}
            </div>
          ) : (
            <div>
              <Label>Upload Photo</Label>
              <input
                type="file"
                accept="image/*"
                className="mt-1 w-full text-sm"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  // Upload to get URL
                  const formData = new FormData()
                  formData.append('file', file)
                  const res = await fetch('/api/photos/upload', { method: 'POST', body: formData })
                  const { url } = await res.json()
                  setPhotoUrl(url)
                }}
              />
            </div>
          )}

          <div>
            <Label>Condition</Label>
            <Select defaultValue="good" onValueChange={(v) => setValue('condition', v as FormData['condition'])}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_with_tags">New with tags</SelectItem>
                <SelectItem value="excellent">Excellent</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="fair">Fair</SelectItem>
                <SelectItem value="poor">Poor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Valuating...</> : 'Get Valuation'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
