'use client'
import { useMutation } from '@tanstack/react-query'
import { ValuationResult } from '@/types'

export function useValuate() {
  return useMutation<ValuationResult, Error, { itemQuery: string; condition: string; imageUrl?: string }>({
    mutationFn: (payload) =>
      fetch('/api/valuate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
  })
}
