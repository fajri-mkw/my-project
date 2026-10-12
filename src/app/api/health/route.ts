import { NextResponse } from 'next/server'
import { withEdgeCache } from '@/lib/edge-cache'

// Lightweight health check — NO Prisma import, NO DB query.
// Previously imported `ensureDbConnection` from @/lib/db, which loads Prisma's
// WASM module + runs ensureSchemaSync() on every call — burning CPU on
// Cloudflare Workers free plan and contributing to request quota usage.
//
// This version just returns a static OK response. The DB health is already
// verified indirectly by every other API call that queries the DB.
// If the DB is down, those routes will return 500 — no need for a separate
// health check that itself loads Prisma.
// Cached 600s (10 min) — health status doesn't change frequently.
export const GET = withEdgeCache(async () => {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'Server is running',
    databaseType: 'sqlite',
  })
}, { ttl: 600 })
