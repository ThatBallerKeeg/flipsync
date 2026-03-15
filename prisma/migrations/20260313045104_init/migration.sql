-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('DEPOP', 'EBAY');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOLD', 'ENDED', 'RELISTED');

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "platformUserId" TEXT,
    "shopUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "depopDescription" TEXT,
    "ebayDescription" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "originalPrice" DOUBLE PRECISION,
    "category" TEXT,
    "condition" TEXT,
    "brand" TEXT,
    "size" TEXT,
    "color" TEXT,
    "tags" TEXT[],
    "photos" TEXT[],
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "aiData" JSONB,
    "comparables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingPlatform" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformListingId" TEXT,
    "platformUrl" TEXT,
    "platformStatus" TEXT,
    "listedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ListingPlatform_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingAnalytics" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "platformFee" DOUBLE PRECISION,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "buyerInfo" JSONB,
    "shippingInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceComparison" (
    "id" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "itemQuery" TEXT NOT NULL,
    "photoUrl" TEXT,
    "platformData" JSONB NOT NULL,
    "aiSummary" JSONB NOT NULL,
    "priceLow" DOUBLE PRECISION NOT NULL,
    "priceMid" DOUBLE PRECISION NOT NULL,
    "priceHigh" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingPlatform_listingId_platform_key" ON "ListingPlatform"("listingId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ListingAnalytics_listingId_platform_date_key" ON "ListingAnalytics"("listingId", "platform", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_listingId_key" ON "Sale"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceComparison_queryHash_key" ON "PriceComparison"("queryHash");

-- CreateIndex
CREATE INDEX "PriceComparison_queryHash_idx" ON "PriceComparison"("queryHash");

-- AddForeignKey
ALTER TABLE "ListingPlatform" ADD CONSTRAINT "ListingPlatform_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAnalytics" ADD CONSTRAINT "ListingAnalytics_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
