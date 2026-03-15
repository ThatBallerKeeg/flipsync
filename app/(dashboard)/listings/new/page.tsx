'use client'
import { useSearchParams } from 'next/navigation'
import { ListingForm } from '@/components/listing/ListingForm'

export default function NewListingPage() {
  const searchParams = useSearchParams()
  const prefill = searchParams.get('prefill')

  return (
    <div className="mx-auto max-w-5xl">
      <ListingForm
        initialData={prefill ? { title: prefill } : undefined}
      />
    </div>
  )
}
