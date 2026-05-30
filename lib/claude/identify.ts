import Anthropic from '@anthropic-ai/sdk'
import { AIIdentifyResult } from '@/types'
import { withRetry } from './retry'
import { toImageBlock } from './image-blocks'
import { parseClaudeJson } from './parse-json'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function identifyItemFromImage(imageUrls: string | string[]): Promise<AIIdentifyResult> {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls]

  const imageBlocks = await Promise.all(urls.slice(0, 4).map(toImageBlock))

  const response = await withRetry(() => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: `You are an expert reseller and vintage clothing authenticator with deep knowledge of streetwear, vintage, and contemporary fashion brands AND their typical resale prices on Depop and eBay (US market). Analyse ALL provided product photos together.

Return a single JSON object with these exact fields:
- brand: brand name (check tags, logos — be specific e.g. "Carhartt", "Nike", "Marvel x Mad Engine")
- item_type: specific item type (e.g. "graphic tee", "zip-up hoodie", "cargo pants")
- model_name: model/collection name if identifiable, else null
- condition: one of "new_with_tags" | "excellent" | "good" | "fair" | "poor"
- size: size label if visible on tag, else null
- colors: array of 1-2 dominant colors with precise shade names (e.g. ["sky blue"] or ["black", "white"])
- color: the single most dominant color (same as colors[0])
- material: fabric if visible on tag, else best guess
- notable_features: array of up to 6 key selling features
- tags: array of exactly 5 Depop hashtag keywords WITHOUT # — pick the 5 most impactful (brand, item type, style/era, key feature, aesthetic)
- suggested_category_depop: best Depop category
- suggested_title: resale title under 80 chars (brand + item + key detail)
- estimated_price_usd: integer — your best estimate of what this SPECIFIC item sells for on Depop/eBay in this exact condition. Use real resale market knowledge. A plain Hanes tee in good condition is ~$8-12. A Carhartt heavyweight hoodie is ~$45-70. A Supreme box logo tee is ~$150-300. A Levi's 501 in good condition is ~$25-40. Take CONDITION into account: poor = 40-50% of excellent, fair = 60-70%, good = 80%, new_with_tags = 110-130%.
- estimated_price_range_usd: [low, high] — your 25th and 75th percentile estimate
- price_reasoning: ONE short sentence explaining the estimate (e.g. "Vintage Carhartt hoodies in good condition sell $45-65")

CRITICAL: Vary prices honestly based on brand desirability, item type, and condition. Do NOT default to round numbers like $25 or $28 for everything. Generic unbranded items: $8-20. Mid-tier brands (Hanes, Old Navy, Champion basics): $10-25. Premium streetwear (Carhartt, Stussy, Nike SB): $30-90. Hyped (Supreme, Palace, Yeezy, Jordan): $80-400+. Luxury (Gucci, LV, Balenciaga): $200-2000+.

Return ONLY valid JSON, no prose, no markdown fences.`,
    messages: [
      {
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Analyse ${urls.length > 1 ? 'all ' + urls.length + ' photos' : 'this photo'} and return the JSON identification.`,
          },
        ],
      },
    ],
  }), 'identify')

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  const parsed = parseClaudeJson<AIIdentifyResult>(text, 'object')

  if (!parsed) {
    console.warn(`[identify] Unparseable response: ${text.slice(0, 150)}`)
    return {} as AIIdentifyResult
  }

  if (!parsed.colors && parsed.color) parsed.colors = [parsed.color]
  if (!parsed.color && parsed.colors?.[0]) parsed.color = parsed.colors[0]

  return parsed
}
