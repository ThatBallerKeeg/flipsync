import { prisma } from '@/lib/db/client'
import { decryptToken } from '@/lib/tokens/platformTokens'

const EBAY_API_BASE = 'https://api.ebay.com'
const SANDBOX_API_BASE = 'https://api.sandbox.ebay.com'

const BASE_URL = process.env.NODE_ENV === 'production' ? EBAY_API_BASE : SANDBOX_API_BASE

export async function getEbayAccessToken(): Promise<string | null> {
  const account = await prisma.connectedAccount.findFirst({
    where: { platform: 'EBAY' },
  })
  if (!account) return null
  return decryptToken(account.accessToken)
}

export async function ebayFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getEbayAccessToken()
  if (!token) throw new Error('eBay not connected')

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
}
