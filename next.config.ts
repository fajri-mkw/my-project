import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ["127.0.0.1"],
  // Cloudflare Workers: disable Next.js Image optimization (uses sharp, which
  // requires native bindings not available on Workers). Use Cloudflare Images
  // or Image Resizing if optimization is needed in the future.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
