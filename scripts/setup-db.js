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
}

setupSchema();
