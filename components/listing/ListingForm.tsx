'use client'
import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PhotoUploader } from './PhotoUploader'
import { AIAssistPanel } from './AIAssistPanel'
import { DescriptionEditor } from './DescriptionEditor'
import { AIIdentifyResult, ComparableListing, Listing, PriceSuggestion } from '@/types'
import { useToast } from '@/hooks/useToast'
import { Loader2, Save, ChevronRight, ChevronLeft } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'

const schema = z.object({
  title: z.string().optional(),
  price: z.coerce.number().positive('Price must be positive'),
  originalPrice: z.coerce.number().optional(),
  brand: z.string().optional(),
  category: z.string().optional(),
  condition: z.enum(['new_with_tags', 'excellent', 'good', 'fair', 'poor']).optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  depopDescription: z.string().optional(),
})

type FormData = z.infer<typeof schema>

const STEPS = ['Photos', 'AI Assist', 'Description', 'Review & Save'] as const

interface Props {
  initialData?: Partial<Listing>
  onSave?: (data: Partial<Listing>) => Promise<unknown>
}

export function ListingForm({ initialData, onSave }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState(initialData ? 3 : 0)
  const [photos, setPhotos] = useState<string[]>(initialData?.photos ?? [])
  const [identified, setIdentified] = useState<AIIdentifyResult | null>(null)
  const [comparables, setComparables] = useState<ComparableListing[]>([])
  const [priceSuggestion, setPriceSuggestion] = useState<PriceSuggestion | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [listingId, setListingId] = useState<string | null>(initialData?.id ?? null)

  const { register, handleSubmit, setValue, watch, getValues, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: initialData?.title ?? '',
      price: initialData?.price ?? 0,
      originalPrice: initialData?.originalPrice ?? undefined,
      brand: initialData?.brand ?? '',
      category: initialData?.category ?? '',
      condition: (initialData?.condition as FormData['condition']) ?? 'good',
      size: initialData?.size ?? '',
      color: initialData?.color ?? '',
      description: initialData?.description ?? '',
      depopDescription: initialData?.depopDescription ?? '',
    },
  })

  const depopDescription = watch('depopDescription') ?? ''

  const runAIAnalysis = useCallback(async (allPhotos: string[]) => {
    if (!allPhotos.length) return
    setAiLoading(true)
    try {
      // 1. Identify item using ALL uploaded photos
      const identRes = await fetch('/api/ai/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: allPhotos }),
      })
      const itemData: AIIdentifyResult = await identRes.json()
      setIdentified(itemData)

      // Auto-fill form fields
      if (itemData.suggested_title) setValue('title', itemData.suggested_title)
      if (itemData.brand) setValue('brand', itemData.brand)
      if (itemData.color) setValue('color', itemData.color)
      if (itemData.size) setValue('size', itemData.size)
      if (itemData.condition) setValue('condition', itemData.condition)
      if (itemData.suggested_category_depop) setValue('category', itemData.suggested_category_depop)

      // 2. Search comparables
      const query = itemData.suggested_title ?? `${itemData.brand ?? ''} ${itemData.item_type ?? ''}`.trim()
      const compRes = await fetch(`/api/search/comparables?q=${encodeURIComponent(query)}`)
      const { results } = await compRes.json()
      setComparables(results ?? [])

      // 3. Get price suggestion
      const priceRes = await fetch('/api/ai/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemQuery: query, condition: itemData.condition ?? 'good' }),
      })
      const priceData = await priceRes.json()
      setPriceSuggestion(priceData)
      if (priceData.mid && !getValues('price')) setValue('price', priceData.mid)

      // 4. Generate Depop description
      const descRes = await fetch('/api/ai/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemData, comparables: results ?? [] }),
      })
      const descData = await descRes.json()
      if (descData.depop) setValue('depopDescription', descData.depop)

      if (step === 0) setStep(1)
    } catch {
      toast({ title: 'AI analysis failed', description: 'You can still fill in details manually.', variant: 'destructive' })
    } finally {
      setAiLoading(false)
    }
  }, [step, setValue, getValues, toast])

  // Trigger AI on first photo upload
  const handleFirstPhoto = useCallback((url: string) => {
    runAIAnalysis([url])
  }, [runAIAnalysis])

  const buildListingData = () => {
    const data = getValues()
    const title = identified?.suggested_title || `${data.brand || ''} ${identified?.item_type || ''}`.trim() || 'Depop Listing'
    return { ...data, title }
  }

  const saveAsDraft = async () => {
    const data = buildListingData()
    setSaving(true)
    try {
      if (listingId && onSave) {
        await onSave({ ...data, photos, status: 'DRAFT' })
        toast({ title: 'Saved', description: 'Listing updated.' })
      } else {
        const res = await fetch('/api/listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, photos, status: 'DRAFT', aiData: identified, comparables }),
        })
        const listing = await res.json()
        setListingId(listing.id)
        toast({ title: 'Draft saved', description: 'You can publish it anytime.' })
        router.push(`/listings/${listing.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(i)}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors',
                i === step ? 'bg-primary text-primary-foreground'
                  : i < step ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}
            </button>
            <span className={cn('text-sm hidden sm:block', i === step ? 'font-medium' : 'text-muted-foreground')}>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 0: Photos */}
      {step === 0 && (
        <Card>
          <CardHeader><CardTitle>Step 1 — Upload Photos</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {aiLoading && (
              <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                AI is analysing your item...
              </div>
            )}
            <PhotoUploader
              photos={photos}
              onChange={setPhotos}
              onFirstPhotoUploaded={handleFirstPhoto}
            />
            <div className="flex justify-end gap-2">
              {photos.length > 1 && !aiLoading && (
                <Button variant="outline" onClick={() => runAIAnalysis(photos)} disabled={aiLoading}>
                  Re-analyse all photos
                </Button>
              )}
              <Button onClick={() => setStep(1)} disabled={photos.length === 0}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 1: AI Assist */}
      {step === 1 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Step 2 — Item Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="brand">Brand</Label>
                  <Input id="brand" {...register('brand')} className="mt-1" />
                </div>
                <div>
                  <Label>Condition</Label>
                  <Select defaultValue={getValues('condition')} onValueChange={(v) => setValue('condition', v as FormData['condition'])}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new_with_tags">New with tags</SelectItem>
                      <SelectItem value="excellent">Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="size">Size</Label>
                  <Input id="size" {...register('size')} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="color">Color</Label>
                  <Input id="color" {...register('color')} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="price">Price ($) *</Label>
                  <Input id="price" type="number" step="0.01" {...register('price')} className="mt-1" />
                  {errors.price && <p className="mt-1 text-xs text-destructive">{errors.price.message}</p>}
                </div>
                <div>
                  <Label htmlFor="originalPrice">Original Price ($)</Label>
                  <Input id="originalPrice" type="number" step="0.01" {...register('originalPrice')} className="mt-1" />
                </div>
              </div>
              {identified?.tags?.length ? (
                <div>
                  <Label className="text-xs text-muted-foreground">AI-detected tags</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {identified.tags.map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">#{t}</Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(0)}>
                  <ChevronLeft className="mr-1 h-4 w-4" />Back
                </Button>
                <Button onClick={() => setStep(2)}>
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <AIAssistPanel
            identified={identified}
            comparables={comparables}
            priceSuggestion={priceSuggestion}
            loading={aiLoading}
            onSelectPrice={(price) => setValue('price', price)}
          />
        </div>
      )}

      {/* Step 2: Description */}
      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Step 3 — Description</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <DescriptionEditor
              depopDescription={depopDescription}
              onDepopChange={(v) => setValue('depopDescription', v)}
              itemData={identified ?? undefined}
              comparables={comparables}
            />
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-1 h-4 w-4" />Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review & Publish */}
      {step === 3 && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Listing Preview</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {photos[0] && (
                <img src={photos[0]} alt="" className="w-full rounded-lg object-cover aspect-square max-h-64" />
              )}
              <div>
                <h3 className="font-semibold text-lg">{identified?.suggested_title || `${watch('brand') || ''} ${identified?.item_type || ''}`.trim() || 'Untitled'}</h3>
                <p className="text-2xl font-bold text-primary mt-1">{formatCurrency(watch('price') || 0)}</p>
                <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                  {watch('brand') && <span><span className="text-muted-foreground">Brand: </span>{watch('brand')}</span>}
                  {watch('condition') && <span><span className="text-muted-foreground">Condition: </span>{watch('condition')}</span>}
                  {watch('size') && <span><span className="text-muted-foreground">Size: </span>{watch('size')}</span>}
                  {watch('color') && <span><span className="text-muted-foreground">Color: </span>{watch('color')}</span>}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Save Listing</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Your listing will be saved as a draft. Drafts are automatically published to Depop based on your schedule in Settings.
              </p>

              <Button className="w-full" onClick={saveAsDraft} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Listing
              </Button>

              <Button variant="ghost" className="w-full" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-1 h-4 w-4" />Back to Description
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
