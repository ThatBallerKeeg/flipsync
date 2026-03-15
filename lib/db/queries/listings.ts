import { prisma } from '@/lib/db/client'
import { Prisma, ListingStatus, Platform } from '@prisma/client'

export async function getListings(filters?: {
  status?: ListingStatus
  platform?: Platform
  search?: string
}) {
  const where: Prisma.ListingWhereInput = {}

  if (filters?.status) where.status = filters.status
  if (filters?.platform) {
    where.platforms = { some: { platform: filters.platform } }
  }
  if (filters?.search) {
    where.OR = [
      { title: { contains: filters.search, mode: 'insensitive' } },
      { brand: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  return prisma.listing.findMany({
    where,
    include: {
      platforms: true,
      analytics: {
        where: {
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      },
      sale: true,
    },
    orderBy: { updatedAt: 'desc' },
  })
}

export async function getListingById(id: string) {
  return prisma.listing.findUnique({
    where: { id },
    include: {
      platforms: true,
      analytics: true,
      sale: true,
    },
  })
}

export async function createListing(data: Prisma.ListingCreateInput) {
  return prisma.listing.create({ data, include: { platforms: true } })
}

export async function updateListing(id: string, data: Prisma.ListingUpdateInput) {
  return prisma.listing.update({
    where: { id },
    data,
    include: { platforms: true },
  })
}

export async function deleteListing(id: string) {
  return prisma.listing.delete({ where: { id } })
}
