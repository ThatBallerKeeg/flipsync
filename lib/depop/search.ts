import { ComparableListing } from '@/types'

// Depop public search uses Brave Search targeting site:depop.com
export async function searchDepopComparables(query: string): Promise<ComparableListing[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return []

  const searchQuery = `${query} sold site:depop.com`
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=10`

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })

  if (!res.ok) return []
  const data = await res.json()

  return (data.web?.results ?? [])
    .map((r: Record<string, unknown>) => {
      const priceMatch = String(r.description ?? r.title ?? '').match(/£(\d+(?:\.\d{2})?)/)
      if (!priceMatch) return null
      return {
        title: String(r.title ?? '').substring(0, 80),
        platform: 'Depop',
        price: parseFloat(priceMatch[1]),
        currency: 'GBP',
        url: r.url as string,
      } as ComparableListing
    })
    .filter(Boolean) as ComparableListing[]
}
