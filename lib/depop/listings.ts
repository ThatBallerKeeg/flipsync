/**
 * Depop listing creation.
 *
 * Uses Playwright browser automation against www.depop.com/products/create/
 * because the mobile API (api.depop.com) blocks product creation for web
 * session tokens — only PATCH (edit) and GET work with those tokens.
 *
 * The web sell form at webapi.depop.com accepts the same token via cookie
 * and has full product creation capability.
 */
import { createDepopListingBrowser } from './browser'
import type { Listing } from '@/types'

export async function createDepopListing(
  listing: Listing
): Promise<{ listingId: string; url: string }> {
  return createDepopListingBrowser(listing)
}
