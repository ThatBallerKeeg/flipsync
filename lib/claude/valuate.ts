import Anthropic from '@anthropic-ai/sdk'
import { ComparableListing, PriceSuggestion } from '@/types'
import { withRetry } from './retry'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function synthesizeValuation(
  itemQuery: string,
  condition: string,
  comparables: ComparableListing[]
): Promise<PriceSuggestion> {
  // Haiku is sufficient for this pure-text pricing calculation
  const response = await withRetry(() => client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You are a pricing expert for resale items. Given recent sold listings, calculate: price_low (10th percentile), price_mid (median), price_high (90th percentile), confidence (0-1 based on number and recency of comps), platform_recommendation (which platform likely yields higher price, one sentence), trend (rising | stable | falling). Return ONLY valid JSON.`,
    messages: [
      {
        role: 'user',
        content: `Item: ${itemQuery}
Condition: ${condition}

Recent sold comparables:
${JSON.stringify(comparables, null, 2)}

Return JSON with: price_low, price_mid, price_high, confidence, platform_recommendation, trend`,
      },
    ],
  }), 'valuate')

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}'
  const match = text.match(/\{[\s\S]*\}/)
  const data = match ? JSON.parse(match[0]) : {}

  const toNum = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }

  return {
    low: toNum(data.price_low),
    mid: toNum(data.price_mid),
    high: toNum(data.price_high),
    confidence: toNum(data.confidence),
    currency: 'USD',
    platform_recommendation: data.platform_recommendation,
    trend: data.trend,
  }
}
