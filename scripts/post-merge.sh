#!/bin/bash
set -e
npm install
# Backfill null organization_id values before applying NOT NULL constraints
npx tsx scripts/migrate-org-scoping.ts
# Push schema directly via drizzle-kit so --force is properly forwarded
# (npm run db:push --force passes --force to npm, not drizzle-kit)
npx drizzle-kit push --force
