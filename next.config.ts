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
  // Aggressive cache headers for static assets to reduce Worker requests.
  // Cloudflare's ASSETS binding serves /_next/static/* directly, but adding
  // explicit Cache-Control headers helps browsers cache longer.
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:path*.(jpg|jpeg|png|gif|webp|svg|ico|woff|woff2|ttf|eot)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=2592000, immutable' },
        ],
      },
      {
        // HTML pages: short cache (30s) so users see updates quickly
        source: '/((?!api).*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=30' },
        ],
      },
    ]
  },
};

export default nextConfig;
