import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID!
  const redirectUri = process.env.EBAY_REDIRECT_URI!
  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  ].join('%20')

  const state = Buffer.from(crypto.randomUUID()).toString('base64url')
  const authUrl =
    `https://auth.ebay.com/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${scopes}` +
    `&state=${state}`

  return NextResponse.redirect(authUrl)
}
