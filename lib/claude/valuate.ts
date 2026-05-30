import Anthropic from '@anthropic-ai/sdk'
import { ComparableListing, PriceSuggestion } from '@/types'
import { withRetry } from './retry'
import { parseClaudeJson } from './parse-json'

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
    system: `You are a pricing expert for resale items. Given recent sold listings, calculate price_low (10th percentile), price_mid (median), price_high (90th percentile), confidence (0-1), platform_recommendation (one sentence), trend (rising|stable|falling). Return ONLY valid JSON, no prose, no markdown fences.`,
    messages: [
      {
        role: 'user',
        content: `Item: ${itemQuery}
Condition: ${condition}

Recent sold comparables:
${JSON.stringify(comparables, null, 2)}

Return JSON with keys: price_low, price_mid, price_high, confidence, platform_recommendation, trend`,
      },
    ],
  }), 'valuate')

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  const data = parseClaudeJson<Record<string, unknown>>(text, 'object')

  const toNum = (v: unknown) => { const n = parseFloat(String(v ?? 0)); return isNaN(n) ? 0 : n }

  if (!data) {
    console.warn(`[valuate] Unparseable response for "${itemQuery}": ${text.slice(0, 120)}`)
    return { low: 0, mid: 0, high: 0, confidence: 0, currency: 'USD' }
  }

  return {
    low: toNum(data.price_low),
    mid: toNum(data.price_mid),
    high: toNum(data.price_high),
    confidence: toNum(data.confidence),
    currency: 'USD',
    platform_recommendation: typeof data.platform_recommendation === 'string' ? data.platform_recommendation : undefined,
    trend: typeof data.trend === 'string' ? (data.trend as 'rising' | 'stable' | 'falling') : undefined,
  }
}
