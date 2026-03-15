'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MobileNav } from '@/components/layout/MobileNav'

const titles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/listings': 'Listings',
  '/listings/new': 'New Listing',
  '/inventory': 'Inventory',
  '/orders': 'Orders',
  '/valuator': 'Item Valuator',
  '/settings': 'Settings',
}

export function TopBar() {
  const pathname = usePathname()
  const title = Object.entries(titles).find(([path]) => pathname.startsWith(path))?.[1] ?? 'FlipSync'

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <MobileNav />
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {pathname.startsWith('/listings') && !pathname.includes('/new') && (
          <Button asChild size="sm">
            <Link href="/listings/new">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Listing</span>
            </Link>
          </Button>
        )}
      </div>
    </header>
  )
}
