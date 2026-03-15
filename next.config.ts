import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  eslint: {
    // ESLint runs in CI; skip during production builds to avoid config compat issues
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.com',
        pathname: '/storage/v1/object/public/**',
      },
      // Depop CDN for listing photos
      {
        protocol: 'https',
        hostname: '*.depop.com',
      },
    ],
  },
  // Enable instrumentation hook for the internal cron scheduler
  instrumentationHook: true,
  experimental: {
    serverActions: {
      // Allow server actions from any origin (covers Railway + custom domains)
      allowedOrigins: process.env.NEXT_PUBLIC_APP_URL
        ? [process.env.NEXT_PUBLIC_APP_URL.replace(/^https?:\/\//, ''), 'localhost:3000', 'localhost:3001']
        : ['localhost:3000', 'localhost:3001'],
    },
  },
}

export default nextConfig
