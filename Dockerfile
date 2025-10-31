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

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

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
