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
  // ==========================================================================
  // BROWSER CACHING for HTML shell — saves Workers requests against free-plan cap
  // ==========================================================================
  // Without these headers, every page navigation re-fetches the HTML shell
  // from the Worker (Next.js defaults to no-store for App Router dynamic pages).
  // Cloudflare Workers free plan caps at 100K requests/day — every page
  // navigation was costing ~13 Worker requests (HTML + 10 JS + 2 CSS), and the
  // JS/CSS bypass via Cloudflare ASSETS binding only saves the asset requests,
  // NOT the HTML. This headers() config tells the browser to cache the HTML
  // shell for 60 seconds, since it's identical for all users (just script
  // tags + loading div).
  //
  // Users see fresh HTML within 60s of any deploy. Static chunks (hashed
  // filenames) are cached by the browser separately and re-validated when
  // their hashes change in the new HTML.
  async headers() {
    return [
      {
        // Match all HTML routes (no file extension) — SPA shell
        source: "/:path*",
        has: [
          {
            type: "request",
            key: "sec-fetch-mode",
          },
        ],
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=60",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
