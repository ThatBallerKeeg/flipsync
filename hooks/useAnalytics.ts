'use client'
import { useQuery } from '@tanstack/react-query'
import { AnalyticsData } from '@/types'

export function useAnalytics() {
  return useQuery<AnalyticsData>({
    queryKey: ['analytics'],
    queryFn: () => fetch('/api/analytics').then((r) => r.json()),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}
