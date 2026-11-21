#!/usr/bin/env node
/**
 * Dynamic Prisma Schema Setup for Pushakin Flows
 *
 * This script automatically configures the Prisma schema based on the
 * DATABASE_URL environment variable:
 *   - SQLite: if URL starts with "file:" (local development / sandbox)
 *   - PostgreSQL: if URL starts with "postgres" (Vercel / Neon)
 *
 * This allows the same codebase to work with both databases.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const dbUrl = process.env.DATABASE_URL || '';

function setupSchema() {
  let schema = fs.readFileSync(schemaPath, 'utf-8');

  const isSQLite = dbUrl.startsWith('file:');
  const isPostgres = dbUrl.startsWith('postgres');

  if (isSQLite) {
    console.log('[DB Setup] Detected SQLite database (local development)');

    // Replace PostgreSQL provider with SQLite
    schema = schema.replace(
      /provider\s+=\s+"postgresql"/,
      'provider = "sqlite"'
    );

    // Remove directUrl line (not needed for SQLite)
    schema = schema.replace(/\s*directUrl\s*=\s*env\("DIRECT_DATABASE_URL"\)\n?/, '\n');

    fs.writeFileSync(schemaPath, schema);
    console.log('[DB Setup] Schema patched for SQLite');

  } else if (isPostgres) {
    console.log('[DB Setup] Detected PostgreSQL database (Neon/Vercel)');

    // Ensure PostgreSQL provider
    if (schema.includes('provider = "sqlite"')) {
      schema = schema.replace(
        /provider\s+=\s+"sqlite"/,
        'provider  = "postgresql"'
      );

      // Add directUrl if missing
      if (!schema.includes('directUrl')) {
        schema = schema.replace(
          /url\s*=\s*env\("DATABASE_URL"\)/,
          'url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_DATABASE_URL")'
        );
      }

      fs.writeFileSync(schemaPath, schema);
      console.log('[DB Setup] Schema patched for PostgreSQL');
    } else {
      console.log('[DB Setup] Schema already configured for PostgreSQL');
    }

  } else {
    console.log('[DB Setup] No DATABASE_URL detected, defaulting to SQLite');

    schema = schema.replace(
      /provider\s+=\s+"postgresql"/,
      'provider = "sqlite"'
    );
    schema = schema.replace(/\s*directUrl\s*=\s*env\("DIRECT_DATABASE_URL"\)\n?/, '\n');

    fs.writeFileSync(schemaPath, schema);
    console.log('[DB Setup] Schema patched for SQLite (default)');
  }

  // Generate Prisma Client
  try {
    console.log('[DB Setup] Generating Prisma Client...');
    execSync('npx prisma generate', {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..')
    });
    console.log('[DB Setup] Prisma Client generated successfully');
  } catch (error) {
    console.error('[DB Setup] Failed to generate Prisma Client:', error.message);
    process.exit(1);
  }

  // Restore pristine @prisma/client entry points (library engine) for LOCAL dev.
  //
  // WHY: `bun run deploy:cf` runs scripts/patch-libsql-cf.sh which rewrites
  // node_modules/@prisma/client/default.js to directly require the WASM engine
  // (required for Cloudflare Workers). But `prisma generate` only regenerates
  // node_modules/.prisma/client — it does NOT restore the outer @prisma/client
  // package. Local dev (file: SQLite) needs the library engine, so we copy the
  // pristine entry files back from scripts/vendor/ on every dev start.
  // The next deploy re-patches them — the cycle is self-consistent.
  restorePristinePrismaClient();

  // For PostgreSQL (Vercel/Neon): push schema changes to ensure DB is in sync
  // This ensures new columns (like workerOutputs, workerCustomOutput) are created
  // without data loss. SQLite uses db:push locally instead.
  if (isPostgres) {
    try {
      console.log('[DB Setup] Pushing schema to PostgreSQL...');
      execSync('npx prisma db push --accept-data-loss', {
        stdio: 'pipe',
        cwd: path.join(__dirname, '..'),
        timeout: 30000
      });
      console.log('[DB Setup] PostgreSQL schema synced successfully');
    } catch (error) {
      console.error('[DB Setup] Warning: Failed to push schema to PostgreSQL:', error.message);
      // Don't exit — the app may still work if schema is already up to date
    }
  }
}

function restorePristinePrismaClient() {
  const vendorDir = path.join(__dirname, 'vendor', 'prisma-client');
  const targetDir = path.join(__dirname, '..', 'node_modules', '@prisma', 'client');
  const files = ['default.js', 'index.js'];
  let restored = 0;

  for (const file of files) {
    const src = path.join(vendorDir, file);
    const dst = path.join(targetDir, file);
    try {
      const pristine = fs.readFileSync(src, 'utf-8');
      const current = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf-8') : '';
      if (current !== pristine) {
        fs.writeFileSync(dst, pristine);
        restored++;
      }
    } catch (err) {
      console.warn(`[DB Setup] Warning: could not restore @prisma/client/${file}: ${err.message}`);
    }
  }

  if (restored > 0) {
    console.log(`[DB Setup] Restored ${restored} pristine @prisma/client file(s) (local library engine)`);
  }
}

setupSchema();
