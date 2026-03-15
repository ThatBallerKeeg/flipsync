import { ebayFetch } from './client'

export async function getEbayTrafficReport(listingIds: string[]): Promise<Record<string, { views: number; clicks: number }>> {
  if (!listingIds.length) return {}

  const res = await ebayFetch(
    `/sell/analytics/v1/traffic_report?dimension=LISTING&metric=CLICK_THROUGH_RATE,LISTING_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL`,
    { method: 'GET' }
  )

  if (!res.ok) return {}
  const data = await res.json()
  const result: Record<string, { views: number; clicks: number }> = {}

  for (const record of data.records ?? []) {
    const id = record.dimensionValues?.[0]?.value
    if (id && listingIds.includes(id)) {
      result[id] = {
        views: record.metricValues?.[2]?.value ?? 0,
        clicks: record.metricValues?.[1]?.value ?? 0,
      }
    }
  }

  return result
}
