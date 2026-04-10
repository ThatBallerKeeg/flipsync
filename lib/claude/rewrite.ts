import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function rewriteListingDescription(
  description: string,
  title: string
): Promise<string> {
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `You are a Depop reseller writing a BRAND NEW listing for an item you're reposting. Write it from scratch — do NOT just rephrase the old description. Make it feel like a completely different listing.

Rules:
- Write 2-3 short casual paragraphs in a natural Depop seller voice
- MUST keep these facts identical: brand, item type, size, measurements, color, condition, any flaws
- Start with a different hook/opening than the original (e.g. "Sick vintage find 🔥", "Hard to find piece", "Clean [brand] [item]", etc.)
- Vary the structure — if the original leads with brand, lead with style/era instead
- End with a shipping/offers line but word it differently each time
- Write EXACTLY 5 hashtags at the end — mix it up with different relevant tags (style, era, aesthetic, brand, vibe). Don't reuse the same 5 hashtags
- 1-2 emojis max in the body
- DO NOT copy phrases from the original — write fresh
- DO NOT use markdown formatting
- DO NOT include "PLEASE DO NOT BUY" or "NOT FOR SALE" — this is a fresh active listing
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
