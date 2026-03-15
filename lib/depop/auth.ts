import { prisma } from '@/lib/db/client'
import { encryptToken, decryptToken } from '@/lib/tokens/platformTokens'

const DEPOP_API_BASE = 'https://api.depop.com'

/**
 * Store a manually-obtained Depop access token (from browser DevTools).
 * Depop uses magic-link auth so tokens must be extracted from the browser.
 */
export async function storeDepopToken(accessToken: string, username: string): Promise<void> {
  // Tokens from Depop's web session last ~1 year — store with long expiry
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)

  await prisma.connectedAccount.upsert({
    where: { id: 'depop-singleton' },
    create: {
      id: 'depop-singleton',
      platform: 'DEPOP',
      accessToken: encryptToken(accessToken),
      refreshToken: null,
      expiresAt,
      shopUsername: username,
    },
    update: {
      accessToken: encryptToken(accessToken),
      refreshToken: null,
      expiresAt,
      shopUsername: username,
    },
  })
}

/**
 * Get the stored Depop access token.
 * Returns null if not connected.
 */
export async function getValidDepopToken(): Promise<string | null> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: 'depop-singleton' } })
  if (!account) return null

  try {
    return decryptToken(account.accessToken)
  } catch {
    return null
  }
}

/**
 * Get the full connected Depop account record (token + username).
 */
export async function getDepopAccount(): Promise<{ token: string; username: string } | null> {
  const account = await prisma.connectedAccount.findUnique({ where: { id: 'depop-singleton' } })
  if (!account || !account.shopUsername) return null

  try {
    const token = decryptToken(account.accessToken)
    return { token, username: account.shopUsername }
  } catch {
    return null
  }
}
