import { ebayFetch } from './client'
import { Listing } from '@/types'

export async function createEbayListing(listing: Listing): Promise<{ listingId: string; url: string }> {
  const sku = listing.id

  // Step 1: Create inventory item
  await ebayFetch(`/sell/inventory/v1/inventory_item/${sku}`, {
    method: 'PUT',
    body: JSON.stringify({
      availability: {
        shipToLocationAvailability: { quantity: 1 },
      },
      condition: mapCondition(listing.condition),
      product: {
        title: listing.title,
        description: listing.ebayDescription ?? listing.description ?? '',
        imageUrls: listing.photos.slice(0, 12),
        aspects: {
          Brand: [listing.brand ?? 'Unbranded'],
          ...(listing.size && { Size: [listing.size] }),
          ...(listing.color && { Colour: [listing.color] }),
          Condition: [listing.condition ?? 'Used'],
        },
      },
    }),
  })

  // Step 2: Create offer
  const offerRes = await ebayFetch('/sell/listing/v1_beta/offer', {
    method: 'POST',
    body: JSON.stringify({
      sku,
      marketplaceId: 'EBAY_GB',
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: '11450', // default: clothing
      listingDescription: listing.ebayDescription ?? listing.description ?? '',
      listingPolicies: {
        fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID ?? '',
        paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID ?? '',
        returnPolicyId: process.env.EBAY_RETURN_POLICY_ID ?? '',
      },
      pricingSummary: {
        price: { value: listing.price.toFixed(2), currency: 'GBP' },
      },
    }),
  })

  const { offerId } = await offerRes.json()

  // Step 3: Publish offer
  const publishRes = await ebayFetch(`/sell/listing/v1_beta/offer/${offerId}/publish`, {
    method: 'POST',
  })
  const { listingId } = await publishRes.json()

  return {
    listingId,
    url: `https://www.ebay.co.uk/itm/${listingId}`,
  }
}

function mapCondition(condition?: string | null): string {
  const map: Record<string, string> = {
    new_with_tags: 'NEW_WITH_TAGS',
    excellent: 'LIKE_NEW',
    good: 'VERY_GOOD',
    fair: 'GOOD',
    poor: 'ACCEPTABLE',
  }
  return map[condition ?? ''] ?? 'VERY_GOOD'
}
