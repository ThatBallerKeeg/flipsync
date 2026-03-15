import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { encryptToken } from '@/lib/tokens/platformTokens'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=depop_denied`)
  }

  const res = await fetch('https://api.depop.com/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DEPOP_REDIRECT_URI!,
      client_id: process.env.DEPOP_CLIENT_ID!,
      client_secret: process.env.DEPOP_CLIENT_SECRET!,
    }),
  })

  if (!res.ok) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=depop_token`)
  }

  const data = await res.json()

  // Fetch shop username
  let shopUsername: string | undefined
  try {
    const profileRes = await fetch('https://api.depop.com/api/v2/account/', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    if (profileRes.ok) {
      const profile = await profileRes.json()
      shopUsername = profile.username
    }
  } catch { /* ignore */ }

  await prisma.connectedAccount.upsert({
    where: { id: 'depop-singleton' },
    create: {
      id: 'depop-singleton',
      platform: 'DEPOP',
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      shopUsername,
    },
    update: {
      accessToken: encryptToken(data.access_token),
      refreshToken: data.refresh_token ? encryptToken(data.refresh_token) : null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      shopUsername,
    },
  })

  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?connected=depop`)
}
