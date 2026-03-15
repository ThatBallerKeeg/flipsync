export type Platform = 'DEPOP' | 'EBAY'
export type ListingStatus = 'DRAFT' | 'ACTIVE' | 'SOLD' | 'ENDED' | 'RELISTED'
export type Condition = 'new_with_tags' | 'excellent' | 'good' | 'fair' | 'poor'

export interface ConnectedAccount {
  id: string
  platform: Platform
  shopUsername?: string | null
  expiresAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Listing {
  id: string
  title: string
  description?: string | null
  depopDescription?: string | null
  ebayDescription?: string | null
  price: number
  originalPrice?: number | null
  category?: string | null
  condition?: string | null
  brand?: string | null
  size?: string | null
  color?: string | null
  tags: string[]
  photos: string[]
  status: ListingStatus
  aiData?: Record<string, unknown> | null
  comparables?: ComparableListing[] | null
  platforms?: ListingPlatform[]
  analytics?: ListingAnalytics[]
  sale?: Sale | null
  createdAt: Date
  updatedAt: Date
}

export interface ListingPlatform {
  id: string
  listingId: string
  platform: Platform
  platformListingId?: string | null
  platformUrl?: string | null
  platformStatus?: string | null
  listedAt?: Date | null
  syncedAt?: Date | null
}

export interface ListingAnalytics {
  id: string
  listingId: string
  platform: Platform
  date: Date
  views: number
  likes: number
  impressions: number
  clicks: number
}

export interface Sale {
  id: string
  listingId: string
  platform: Platform
  salePrice: number
  platformFee?: number | null
  soldAt: Date
  buyerInfo?: Record<string, unknown> | null
  shippingInfo?: Record<string, unknown> | null
}

export interface ComparableListing {
  title: string
  platform: string
  price: number
  currency: string
  soldDate?: string
  url?: string
  condition?: string
}

export interface AIIdentifyResult {
  brand?: string
  item_type?: string
  model_name?: string
  condition?: Condition
  size?: string
  color?: string
  colors?: string[]
  material?: string
  notable_features?: string[]
  tags?: string[]
  suggested_category_depop?: string
  suggested_title?: string
}

export interface PriceSuggestion {
  low: number
  mid: number
  high: number
  confidence: number
  currency: string
  platform_recommendation?: string
  trend?: 'rising' | 'stable' | 'falling'
}

export interface ValuationResult {
  id: string
  itemQuery: string
  photoUrl?: string | null
  platformData: Record<string, unknown>
  aiSummary: {
    price_low: number
    price_mid: number
    price_high: number
    confidence: number
    platform_recommendation: string
    trend: 'rising' | 'stable' | 'falling'
  }
  priceLow: number
  priceMid: number
  priceHigh: number
  confidence: number
  comparables?: ComparableListing[]
  createdAt: Date
}

export interface AnalyticsData {
  totalRevenue: number
  itemsSold30d: number
  avgSalePrice30d: number
  sellThroughRate: number
  totalListings: number
  activeListings: number
  soldListings: number
  draftListings: number
  revenueByWeek: Array<{
    week: string
    ebay: number
    depop: number
  }>
  platformComparison: {
    ebay: { avgPrice: number; avgDaysToSell: number; sellThrough: number }
    depop: { avgPrice: number; avgDaysToSell: number; sellThrough: number }
  }
  topListings: Array<{
    id: string
    title: string
    photos: string[]
    price: number
    platforms: Platform[]
    views7d: number
    daysListed: number
    status: ListingStatus
  }>
}

export interface Order {
  id: string
  platform: Platform
  platformOrderId: string
  listingId?: string
  itemTitle: string
  itemPhoto?: string
  salePrice: number
  buyerUsername?: string
  buyerAddress?: Record<string, unknown>
  orderDate: Date
  shippingStatus: 'pending' | 'shipped' | 'delivered'
  trackingNumber?: string
  buyerMessage?: string
}

export interface ListingFormData {
  title: string
  description?: string
  depopDescription?: string
  ebayDescription?: string
  price: number
  originalPrice?: number
  category?: string
  condition?: Condition
  brand?: string
  size?: string
  color?: string
  tags: string[]
  photos: string[]
  publishToDepop: boolean
  publishToEbay: boolean
}
