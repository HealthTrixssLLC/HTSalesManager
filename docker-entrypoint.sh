#!/bin/sh
set -e

echo "========================================"
echo "Health Trixss CRM - Docker Entrypoint"
echo "========================================"

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
until node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => { client.end(); process.exit(0); })
  .catch(() => process.exit(1));
" 2>/dev/null; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done

echo "PostgreSQL is ready!"

# Run database migrations
echo "Running database migrations..."
npm run db:push

# Seed default roles if needed (first-time setup)
echo "Database initialized successfully!"

echo "========================================"
echo "Starting Health Trixss CRM..."
echo "========================================"

# Execute the CMD (node dist/index.js)
exec "$@"
