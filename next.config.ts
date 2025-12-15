import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverActions: {
    bodySizeLimit: '10mb', // Increased from default 1mb to allow PDF uploads
  },
};

export default nextConfig;
