'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { ListingForm } from '@/components/listing/ListingForm'

function NewListingContent() {
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

export default function NewListingPage() {
  return (
    <Suspense fallback={null}>
      <NewListingContent />
    </Suspense>
  )
}
