import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// OpenNext config for deploying Next.js to Cloudflare Pages.
//
// This adapter converts the Next.js app (App Router, Route Handlers, SSR)
// into a Cloudflare Worker that runs on Cloudflare's edge network.
//
// Requirements:
//   - `nodejs_compat` flag (set in wrangler.jsonc)
//   - libSQL/Turso database (set DATABASE_URL + DATABASE_AUTH_TOKEN)
//   - `output: "standalone"` in next.config (already set)
export default defineCloudflareConfig()
