import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function rewriteListingDescription(
  description: string,
  title: string
): Promise<string> {
  const stream = await client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: `Rewrite this Depop listing description to feel fresh while keeping the same meaning and details. Rules:
- Keep all measurements, brand, size, condition details EXACTLY the same
- Change the wording, sentence structure, and flow
- Shuffle or replace hashtags with equally relevant alternatives (keep exactly 5)
- Keep the same casual Depop tone
- Keep emojis minimal (1-2 max)
- Keep the shipping/bundle line but reword it
- DO NOT add new facts or remove existing ones
- DO NOT use markdown formatting
- Return ONLY the new description text`,
    messages: [
      {
        role: 'user',
        content: `Title: ${title}\n\nOriginal description:\n${description}\n\nRewrite it now:`,
      },
    ],
  })

  const response = await stream.finalMessage()
  return response.content.find((b) => b.type === 'text')?.text ?? description
}
