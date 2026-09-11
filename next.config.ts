import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Note: We use client-side uploads to Supabase Storage directly,
  // so serverActions bodySizeLimit is not needed
  // Production is hosted at admin.salo.uk (hostname, not a path). Local visits to
  // /admin 404, so send them into the app instead.
  async redirects() {
    return [
      { source: '/admin', destination: '/auth/login', permanent: false },
      { source: '/admin/:path*', destination: '/:path*', permanent: false },
    ]
  },
}

export default nextConfig;
