import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { encryptToken } from '@/lib/tokens/platformTokens'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=ebay_denied`)
  }

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
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.EBAY_REDIRECT_URI!,
    }),
  })

  if (!res.ok) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=ebay_token`)
  }

  const data = await res.json()

  await prisma.connectedAccount.upsert({
    where: { id: 'ebay-singleton' },
    create: {
      id: 'ebay-singleton',
      platform: 'EBAY',
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : null,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
    update: {
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : null,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?connected=ebay`)
}
