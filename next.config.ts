import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Note: We use client-side uploads to Supabase Storage directly,
  // so serverActions bodySizeLimit is not needed
};

export default nextConfig;
