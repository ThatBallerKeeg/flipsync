'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ValuationForm } from '@/components/valuator/ValuationForm'
import { ValuationResult } from '@/components/valuator/ValuationResult'
import { ValuationResult as ValuationResultType } from '@/types'

export default function ValuatorPage() {
  const [result, setResult] = useState<ValuationResultType | null>(null)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Item Valuator</h2>
        <p className="text-muted-foreground mt-1">Get an AI-powered price estimate for any item based on recent sold listings.</p>
      </div>
      <ValuationForm onResult={setResult} />
      {result && <ValuationResult result={result} />}
    </div>
  )
}
