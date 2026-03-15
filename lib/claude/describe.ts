import Anthropic from '@anthropic-ai/sdk'
import { AIIdentifyResult, ComparableListing } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function generateDepopDescription(
  itemData: AIIdentifyResult,
  comparables: ComparableListing[]
): Promise<string> {
  const tags = itemData.tags ?? []
  const compLines = comparables.slice(0, 4).map((c) => `- ${c.title} sold for $${c.price}`).join('\n')

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    system: `You write Depop listings for a US reseller. Rules:
- 2-3 short casual paragraphs (no corporate speak)
- Mention brand, item type, key graphic/design, color, condition honestly
- Note measurements if known (pit to pit, length)
- Shipping/bundle line: "Fast shipping! Open to offers, bundle for a deal 📦"
- End with EXACTLY 5 hashtags on one line (Depop only allows 5). Pick the 5 most relevant: brand, item type, style/era, key feature, aesthetic
- Use emojis sparingly (1-2 max in body)
- DO NOT use markdown formatting`,
    messages: [
      {
        role: 'user',
        content: `Write a Depop listing for:
${JSON.stringify(itemData, null, 2)}

Sold comps for price context:
${compLines || 'No comps available'}

Pre-identified tags to include: ${tags.join(', ')}

Write the description now:`,
      },
    ],
  })

  const response = await stream.finalMessage()
  return response.content.find((b) => b.type === 'text')?.text ?? ''
}
