import { Worker } from 'bullmq'
import { connection } from './queue'
import { prisma } from '@/lib/db/client'
import { encryptToken, decryptToken } from '@/lib/tokens/platformTokens'

export const refreshTokensWorker = new Worker(
  'refreshTokens',
  async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000) // 30 min from now
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        expiresAt: { lt: soon },
        refreshToken: { not: null },
      },
    })

    for (const account of accounts) {
      try {
        if (account.platform === 'EBAY') {
          await refreshEbayToken(account.id, account.refreshToken!)
        } else if (account.platform === 'DEPOP') {
          await refreshDepopToken(account.id, account.refreshToken!)
        }
      } catch (err) {
        console.error(`Token refresh failed for ${account.platform}:`, err)
      }
    }
  },
  { connection }
)

async function refreshEbayToken(accountId: string, encryptedRefreshToken: string) {
  const refreshToken = decryptToken(encryptedRefreshToken)
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'https://api.ebay.com/oauth/api_scope/sell.inventory',
    }),
  })

  if (!res.ok) throw new Error(`eBay refresh failed: ${res.status}`)
  const data = await res.json()

  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: {
      accessToken: encryptToken(data.access_token),
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  })
}

async function refreshDepopToken(accountId: string, encryptedRefreshToken: string) {
  const refreshToken = decryptToken(encryptedRefreshToken)
  const res = await fetch('https://api.depop.com/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.DEPOP_CLIENT_ID!,
      client_secret: process.env.DEPOP_CLIENT_SECRET!,
    }),
  })

  if (!res.ok) throw new Error(`Depop refresh failed: ${res.status}`)
  const data = await res.json()

  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: {
      accessToken: encryptToken(data.access_token),
      ...(data.refresh_token && { refreshToken: encryptToken(data.refresh_token) }),
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    },
  })
}
