/**
 * Robustly extract JSON from Claude's response text.
 *
 * Claude sometimes wraps JSON in ```json fences, prepends explanation prose,
 * or appends trailing commentary. This helper strips all that and returns
 * the parsed object/array, or null if nothing parseable is found.
 *
 * @param text   Raw response text from Claude
 * @param shape  'object' for {...} or 'array' for [...]
 */
export function parseClaudeJson<T = unknown>(
  text: string,
  shape: 'object' | 'array' = 'object'
): T | null {
  if (!text) return null

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  let cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*$/g, '')
    .trim()

  // Find the outermost JSON block matching the requested shape
  const openChar = shape === 'array' ? '[' : '{'
  const closeChar = shape === 'array' ? ']' : '}'
  const startIdx = cleaned.indexOf(openChar)
  if (startIdx === -1) return null

  // Walk forward tracking nesting depth to find the matching close brace.
  // Handles nested objects/arrays correctly (a naive lastIndexOf would fail).
  let depth = 0
  let inString = false
  let escape = false
  let endIdx = -1
  for (let i = startIdx; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) { endIdx = i; break }
    }
  }
  if (endIdx === -1) return null

  const candidate = cleaned.slice(startIdx, endIdx + 1)
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}
