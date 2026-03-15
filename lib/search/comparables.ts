import { ComparableListing } from '@/types'
import { createHash } from 'crypto'
import { prisma } from '@/lib/db/client'

const BRAVE_API = 'https://api.search.brave.com/res/v1/web/search'
const CACHE_TTL_MS = 1000 * 60 * 60 * 6 // 6 hours

export async function searchComparables(query: string): Promise<ComparableListing[]> {
  const queryHash = createHash('sha256').update(query).digest('hex')

  try {
    const cached = await prisma.priceComparison.findUnique({ where: { queryHash } })
    if (cached) {
      const age = Date.now() - cached.fetchedAt.getTime()
      if (age < CACHE_TTL_MS) return cached.results as unknown as ComparableListing[]
    }
  } catch { /* DB unavailable, skip cache */ }

  const results = await fetchBraveComparables(query)

  try {
    await prisma.priceComparison.upsert({
      where: { queryHash },
      create: { queryHash, query, results: results as unknown as object[] },
      update: { results: results as unknown as object[], fetchedAt: new Date() },
    })
  } catch { /* DB unavailable, skip caching */ }

  return results
}

async function fetchBraveComparables(query: string): Promise<ComparableListing[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) return getMockComparables(query)

  const searches = [
    `${query} sold site:ebay.com`,
    `${query} sold site:depop.com`,
  ]

  const allResults: ComparableListing[] = []

  for (const searchQuery of searches) {
    try {
      const url = `${BRAVE_API}?q=${encodeURIComponent(searchQuery)}&count=10&search_lang=en&country=US`
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const result of (data.web?.results ?? [])) {
        const price = extractPrice(result.description ?? result.title ?? '')
        if (!price) continue
        allResults.push({
          title: result.title?.substring(0, 80) ?? query,
          platform: result.url?.includes('depop.com') ? 'Depop' : 'eBay',
          price,
          currency: 'USD',
          url: result.url,
          soldDate: extractDate(result.description ?? ''),
        })
      }
    } catch { /* continue */ }
  }

  return allResults.slice(0, 10)
}

function extractPrice(text: string): number | null {
  const usdMatch = text.match(/\$(\d+(?:\.\d{2})?)/i)
  if (usdMatch) return parseFloat(usdMatch[1])
  const gbpMatch = text.match(/£(\d+(?:\.\d{2})?)/i)
  if (gbpMatch) return Math.round(parseFloat(gbpMatch[1]) * 1.27)
  return null
}

function extractDate(text: string): string | undefined {
  return text.match(/(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{4})/i)?.[0]
}

function getMockComparables(query: string): ComparableListing[] {
  return [
    { title: `${query} - Used`, platform: 'eBay', price: 25, currency: 'USD', soldDate: '1 Jan 2025' },
    { title: `${query}`, platform: 'Depop', price: 20, currency: 'USD', soldDate: '15 Jan 2025' },
    { title: `${query} Good Condition`, platform: 'eBay', price: 30, currency: 'USD', soldDate: '20 Jan 2025' },
    { title: `${query} Vintage`, platform: 'Depop', price: 35, currency: 'USD', soldDate: '5 Feb 2025' },
    { title: `${query} Original`, platform: 'eBay', price: 28, currency: 'USD', soldDate: '10 Feb 2025' },
  ]
}
