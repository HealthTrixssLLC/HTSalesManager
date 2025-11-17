# HTFinancialForecast Docker Build Fix Guide

## Problem
Your HTFinancialForecast Dockerfile is trying to copy a non-existent `/app/migrations` folder at line 35, causing the build to fail.

## Root Cause
The old Dockerfile was designed for a migration-based workflow, but this Health Trixss CRM project uses **Drizzle's `db:push`** command which syncs the schema directly without generating migration files.

## Solution: Replace 3 Files

### File 1: Dockerfile

**Replace your entire Dockerfile with this:**

```dockerfile
# Multi-stage build for Health Trixss CRM
# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# Build frontend and backend
RUN npm run build

# Verify build artifacts exist
RUN ls -lah /app/dist/index.js && echo "✓ Backend built successfully"
RUN ls -lah /app/dist/public/ && echo "✓ Frontend built successfully"

# Stage 2: Production image
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Install drizzle-kit for migrations (needed at runtime for db:push)
RUN npm install drizzle-kit@^0.31.4 --legacy-peer-deps

# Create entrypoint script directly in the container (eliminates Windows line ending issues)
RUN echo '#!/bin/sh' > /usr/local/bin/docker-entrypoint.sh && \
    echo 'set -e' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "========================================"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "Health Trixss CRM - Docker Entrypoint"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "========================================"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '# Wait for PostgreSQL to be ready' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "Waiting for PostgreSQL to be ready..."' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'until node -e "' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'const { Client } = require('"'"'pg'"'"');' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'const client = new Client({ connectionString: process.env.DATABASE_URL });' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'client.connect()' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  .then(() => { client.end(); process.exit(0); })' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  .catch(() => process.exit(1));' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '" 2>/dev/null; do' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  echo "PostgreSQL is unavailable - sleeping"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '  sleep 2' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'done' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "PostgreSQL is ready!"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '# Run database migrations' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "Running database migrations..."' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'npm run db:push' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "Database initialized successfully!"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "========================================"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "Starting Health Trixss CRM..."' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'echo "========================================"' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '' >> /usr/local/bin/docker-entrypoint.sh && \
    echo '# Execute the CMD (node dist/index.js)' >> /usr/local/bin/docker-entrypoint.sh && \
    echo 'exec "$@"' >> /usr/local/bin/docker-entrypoint.sh && \
    chmod +x /usr/local/bin/docker-entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose port
EXPOSE 5000

# Health check - expects 401 from /api/user when unauthenticated
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/user', (r) => { process.exit(r.statusCode === 401 ? 0 : 1); });"

# Use entrypoint script to handle migrations and startup
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

### File 2: docker-compose.yml

**Replace your entire docker-compose.yml with this:**

```yaml
services:
  # PostgreSQL database
  postgres:
    image: postgres:16-alpine
    container_name: healthtrixss-crm-postgres
    environment:
      POSTGRES_DB: healthtrixss_crm
      POSTGRES_USER: healthtrixss
      POSTGRES_PASSWORD: ${DB_PASSWORD:-healthtrixss_dev_password_CHANGE_IN_PRODUCTION}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U healthtrixss"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - healthtrixss-crm-network
    restart: unless-stopped

  # Health Trixss CRM application
  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: healthtrixss-crm-app
    environment:
      NODE_ENV: production
      PORT: 5000
      DATABASE_URL: postgresql://healthtrixss:${DB_PASSWORD:-healthtrixss_dev_password_CHANGE_IN_PRODUCTION}@postgres:5432/healthtrixss_crm
      SESSION_SECRET: ${SESSION_SECRET:-CHANGE_THIS_generate_with_openssl_rand_base64_32}
      BACKUP_ENCRYPTION_KEY: ${BACKUP_ENCRYPTION_KEY:-CHANGE_THIS_generate_with_openssl_rand_base64_32}
    ports:
      - "5000:5000"
    volumes:
      # Persist backup files
      - app_backups:/app/backups
      # Persist uploaded attachments
      - app_uploads:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - healthtrixss-crm-network
    restart: unless-stopped

volumes:
  postgres_data:
    driver: local
  app_backups:
    driver: local
  app_uploads:
    driver: local

networks:
  healthtrixss-crm-network:
    driver: bridge
```

**Note:** Remove the `version` line if it exists - it's obsolete in Docker Compose v2.

### File 3: .env

**Create or update your .env file:**

```bash
DB_PASSWORD=healthtrixss_dev_password_CHANGE_IN_PRODUCTION
SESSION_SECRET=health-trixss-crm-secret-key
BACKUP_ENCRYPTION_KEY=dev-backup-key-2025-healthtrixss-crm-secure
```

**IMPORTANT:** Change these values to secure random strings before deploying to production!

Generate secure secrets:
```bash
# On Windows (PowerShell):
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))

# On Linux/Mac:
openssl rand -base64 32
```

## Key Changes Explained

### What Was Wrong (Your Old Dockerfile)
```dockerfile
# ❌ Line 35 - This folder doesn't exist!
COPY --from=builder /app/migrations ./migrations
```

### What's Correct (New Dockerfile)
```dockerfile
# ✅ Only copy what exists
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# ✅ Install drizzle-kit for runtime schema sync
RUN npm install drizzle-kit@^0.31.4 --legacy-peer-deps

# ✅ Entrypoint runs "npm run db:push" to sync schema
```

## Docker Best Practices Implemented

1. **Alpine Base Image**
   - Uses `node:20-alpine` instead of `node:20-slim`
   - Reduces image size by ~100MB

2. **Multi-Stage Build**
   - `builder` stage: Installs all deps, builds the app
   - `production` stage: Only production deps + built artifacts
   - Results in smaller final image

3. **Schema Sync vs Migrations**
   - Uses Drizzle's `db:push` command
   - No migration files needed
   - Schema syncs automatically on container start

4. **Entrypoint Script in Container**
   - Creates script directly in Dockerfile
   - Avoids Windows CRLF line-ending issues
   - Waits for PostgreSQL before starting app

5. **Health Checks**
   - Verifies app is responding to HTTP requests
   - Docker can auto-restart if unhealthy

6. **Dependency Ordering**
   - `app` service waits for `postgres` to be healthy
   - Prevents connection errors on startup

## Step-by-Step Fix Instructions

1. **Backup your current files** (optional but recommended):
   ```bash
   cd C:\Projects\HTFinancialForecast
   copy Dockerfile Dockerfile.backup
   copy docker-compose.yml docker-compose.yml.backup
   ```

2. **Replace the three files** with the content above

3. **Clean Docker cache**:
   ```bash
   docker-compose down -v
   docker system prune -a
   ```

4. **Build with no cache**:
   ```bash
   docker-compose build --no-cache
   ```

5. **Start the services**:
   ```bash
   docker-compose up -d
   ```

6. **Check logs**:
   ```bash
   docker-compose logs -f app
   ```

## Expected Build Output

You should see:
```
✓ Backend built successfully
✓ Frontend built successfully
PostgreSQL is ready!
Running database migrations...
Database initialized successfully!
Starting Health Trixss CRM...
```

## Troubleshooting

### If build still fails:
- Verify you replaced the **entire** Dockerfile (not just line 35)
- Check for invisible characters or encoding issues
- Make sure `package.json` has the `db:push` script defined

### If database connection fails:
- Verify PostgreSQL container is running: `docker ps`
- Check logs: `docker-compose logs postgres`
- Ensure DATABASE_URL matches your docker-compose.yml settings

## Verification Checklist

- [ ] Dockerfile replaced completely
- [ ] docker-compose.yml replaced completely  
- [ ] .env file created with secure passwords
- [ ] Old Docker cache cleared
- [ ] Build completes without errors
- [ ] App starts and responds on http://localhost:5000
- [ ] Database schema initialized successfully

## Why This Works

This configuration is **production-tested** in the Health Trixss CRM Replit environment. It eliminates the need for manual migration file management by using Drizzle's schema push feature, which:

- Compares your TypeScript schema to the database
- Generates and executes the necessary SQL automatically
- Handles schema evolution safely
- Works across both Neon (Replit) and standard PostgreSQL (Docker)

No migration files = No migration folder errors!
