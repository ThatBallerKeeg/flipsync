import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function rewriteListingDescription(
  description: string,
  title: string
): Promise<string> {
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `You are a Depop reseller writing a BRAND NEW listing for an item you're reposting. Write it from scratch — do NOT rephrase the old description. Make it feel like a completely different listing.

Rules:
- FIRST LINE IS CRITICAL FOR SEARCH: Depop only shows the first ~40 characters in search results. Lead with Brand + Item Type (e.g. "Vintage Nike Windbreaker —", "Levi's 501 Denim Jeans —", "Carhartt Detroit Jacket —"). Never open with filler like "Selling this" or "Check out".
- Write 2-3 short casual paragraphs in a natural Depop seller voice
- MUST keep these facts identical: brand, item type, size, measurements, color, condition, any flaws
- Naturally weave in searchable keywords: brand, item type, era/decade, style aesthetic, color, material (e.g. "vintage 90s streetwear", "Y2K grunge aesthetic", "retro sportswear"). These boost Depop search ranking.
- Vary the structure from the original — switch up the order of details each time
- End with a shipping/offers line, worded differently every time
- Write EXACTLY 5 hashtags — rotate fresh ones every relist. Use trending aesthetics (y2k, grunge, cottagecore, gorpcore, dark academia), eras (90s, vintage, retro, 2000s), item types, and the brand. NEVER reuse the same 5 hashtags twice.
- 1-2 emojis max in the body
- DO NOT copy phrases from the original — write completely fresh
- DO NOT use markdown formatting
- DO NOT include "PLEASE DO NOT BUY" or "NOT FOR SALE" — this is a live active listing
- Return ONLY the new description text, nothing else`,
    messages: [
      {
        role: 'user',
        content: `Item title: ${title}\n\nPrevious listing description (use for facts only, do NOT copy wording):\n${description}\n\nWrite a brand new listing:`,
      },
    ],
  })

  const response = await stream.finalMessage()
  return response.content.find((b) => b.type === 'text')?.text ?? description
}
