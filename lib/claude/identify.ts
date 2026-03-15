import Anthropic from '@anthropic-ai/sdk'
import { AIIdentifyResult } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function toImageBlock(url: string): Promise<Anthropic.ImageBlockParam> {
  return {
    type: 'image',
    source: { type: 'url', url },
  }
}

export async function identifyItemFromImage(imageUrls: string | string[]): Promise<AIIdentifyResult> {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls]

  const imageBlocks = await Promise.all(urls.slice(0, 4).map(toImageBlock))

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: `You are an expert reseller and vintage clothing authenticator with deep knowledge of streetwear, vintage, and contemporary fashion brands. Analyse ALL provided product photos together.

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
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}'
  const match = text.match(/\{[\s\S]*\}/)
  const data = (match ? JSON.parse(match[0]) : {}) as AIIdentifyResult

  if (!data.colors && data.color) data.colors = [data.color]
  if (!data.color && data.colors?.[0]) data.color = data.colors[0]

  return data
}
