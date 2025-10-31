# Health Trixss CRM - Docker Deployment Guide

## Overview

This guide covers deploying Health Trixss CRM using Docker and Docker Compose. The application includes:
- **Backend**: Node.js/Express with TypeScript
- **Frontend**: React with Vite (bundled into backend)
- **Database**: PostgreSQL 16
- **Features**: RBAC, CSV import/export, encrypted backups, comments system

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Minimum 2GB RAM, 10GB disk space
- Port 5000 available for application
- Port 5432 available for PostgreSQL (or configure different port)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd health-trixss-crm
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Generate strong secrets
export SESSION_SECRET=$(openssl rand -base64 32)
export BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
export DB_PASSWORD=$(openssl rand -base64 24)

# Create .env file
cat > .env << EOF
# Database password for PostgreSQL
DB_PASSWORD=${DB_PASSWORD}

# Session secret for JWT authentication (32 bytes minimum)
SESSION_SECRET=${SESSION_SECRET}

# Backup encryption key for AES-256-GCM (32 bytes)
BACKUP_ENCRYPTION_KEY=${BACKUP_ENCRYPTION_KEY}
EOF

chmod 600 .env
```

**CRITICAL**: Save these secrets securely! You'll need them for:
- Application authentication (SESSION_SECRET)
- Backup file decryption (BACKUP_ENCRYPTION_KEY)
- Database access (DB_PASSWORD)

### 3. Build and Start Services

```bash
# Build the application image
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app
```

### 4. Verify Deployment

```bash
# Check service health
docker-compose ps

# Test application
curl http://localhost:5000/api/health
# Should return 401 (authentication required - this is expected!)

# Check database connection
docker-compose exec app node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => { console.log('✓ DB Connected'); client.end(); });
"
```

### 5. Initial Setup

1. **Access the application**: Open http://localhost:5000 in your browser

2. **Register first user** (for fresh deployments only): 
   - **IMPORTANT**: The first registered user automatically receives Admin role **ONLY if no other Admin users exist in the database**
   - For a fresh Docker deployment, the very first user registered will become Admin
   - Email: your-email@example.com
   - Password: (strong password, min 8 characters)
   - **Note**: If you're migrating from an existing system or restoring a backup, Admin users may already exist

3. **Configure ID patterns** (optional):
   - Navigate to Admin Console → ID Patterns
   - Customize entity ID formats if needed

4. **Create additional users**:
   - Admin Console → Users
   - Assign appropriate roles (Admin, SalesManager, SalesRep, ReadOnly)

5. **Import existing data** (if migrating from Dynamics 365):
   - CSV Import page → Download templates
   - Prepare your CSV files with existing IDs
   - Import with ID preservation enabled

## Architecture

### Container Structure

```
┌─────────────────────────────────────┐
│     healthtrixss-crm (app)          │
│  - Node.js 20 Alpine                │
│  - Express + React (bundled)        │
│  - Port: 5000                       │
│  - Volumes: backups, uploads        │
└─────────────────────────────────────┘
              │
              ↓
┌─────────────────────────────────────┐
│   healthtrixss-db (postgres)        │
│  - PostgreSQL 16 Alpine             │
│  - Port: 5432                       │
│  - Volume: postgres_data            │
└─────────────────────────────────────┘
```

### Persistent Volumes

- **postgres_data**: Database files
- **app_backups**: Encrypted backup files (.htcrm)
- **app_uploads**: Comment attachments and uploaded files

## Environment Variables

### Required Secrets

| Variable | Description | Generation |
|----------|-------------|------------|
| `SESSION_SECRET` | JWT signing key | `openssl rand -base64 32` |
| `BACKUP_ENCRYPTION_KEY` | AES-256 encryption key | `openssl rand -base64 32` |
| `DB_PASSWORD` | PostgreSQL password | `openssl rand -base64 24` |

### Application Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | production | Environment mode |
| `PORT` | 5000 | Application port |
| `DATABASE_URL` | (auto-generated) | PostgreSQL connection string |

## Production Best Practices

### Security

1. **Secrets Management**:
   ```bash
   # Use Docker secrets in Swarm mode
   docker secret create session_secret <(openssl rand -base64 32)
   docker secret create backup_key <(openssl rand -base64 32)
   ```

2. **TLS/SSL Termination**:
   ```bash
   # Use nginx or Traefik as reverse proxy
   # Example nginx config:
   server {
     listen 443 ssl http2;
     server_name crm.yourdomain.com;
     
     ssl_certificate /path/to/cert.pem;
     ssl_certificate_key /path/to/key.pem;
     
     location / {
       proxy_pass http://localhost:5000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```

3. **Firewall Rules**:
   ```bash
   # Only expose port 443 (HTTPS) externally
   # Keep PostgreSQL port 5432 internal only
   sudo ufw allow 443/tcp
   sudo ufw deny 5432/tcp
   ```

### Backup Strategy

1. **Database Backups** (automated via app):
   ```bash
   # Backups are created via Admin Console
   # Files stored in app_backups volume
   docker-compose exec app ls -lah /app/backups
   ```

2. **Volume Backups** (manual):
   ```bash
   # Backup all volumes
   docker run --rm \
     -v healthtrixss_postgres_data:/data \
     -v $(pwd):/backup \
     alpine tar czf /backup/postgres-$(date +%Y%m%d).tar.gz /data
   ```

3. **Automated Backup Script**:
   ```bash
   #!/bin/bash
   # backup-healthtrixss.sh
   DATE=$(date +%Y%m%d-%H%M%S)
   BACKUP_DIR="/backups/healthtrixss"
   
   mkdir -p $BACKUP_DIR
   
   # Backup database volume
   docker run --rm \
     -v healthtrixss_postgres_data:/data \
     -v $BACKUP_DIR:/backup \
     alpine tar czf /backup/db-$DATE.tar.gz /data
   
   # Backup application volumes
   docker run --rm \
     -v healthtrixss_app_backups:/data \
     -v $BACKUP_DIR:/backup \
     alpine tar czf /backup/app-backups-$DATE.tar.gz /data
   
   # Cleanup old backups (keep 30 days)
   find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
   ```

### Monitoring

1. **Health Checks**:
   ```bash
   # Check service health
   docker inspect healthtrixss-crm | grep -A 5 Health
   ```

2. **Log Aggregation**:
   ```bash
   # View all logs
   docker-compose logs -f
   
   # Filter by service
   docker-compose logs -f app
   docker-compose logs -f postgres
   ```

3. **Resource Monitoring**:
   ```bash
   # Monitor resource usage
   docker stats healthtrixss-crm healthtrixss-db
   ```

## Scaling Considerations

### Horizontal Scaling (Multiple App Instances)

```yaml
# docker-compose.yml modifications for scaling
services:
  app:
    deploy:
      replicas: 3
    # Add session store (Redis) for shared sessions
    environment:
      REDIS_URL: redis://redis:6379
```

### Database Performance

```bash
# Increase PostgreSQL resources
# Edit docker-compose.yml:
services:
  postgres:
    command: 
      - "postgres"
      - "-c"
      - "max_connections=200"
      - "-c"
      - "shared_buffers=256MB"
      - "-c"
      - "effective_cache_size=1GB"
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker-compose logs app

# Common issues:
# 1. Database not ready - wait for healthcheck
docker-compose ps

# 2. Missing environment variables
docker-compose config

# 3. Port already in use
sudo lsof -i :5000
```

### Database Connection Errors

```bash
# Test database connectivity
docker-compose exec app psql $DATABASE_URL -c "SELECT 1;"

# Reset database (WARNING: destroys data)
docker-compose down -v
docker-compose up -d
```

### Migration Failures

```bash
# Manually run migrations
docker-compose exec app npm run db:push

# Force push schema changes
docker-compose exec app npm run db:push -- --force
```

### Permission Errors

```bash
# Fix volume permissions
docker-compose down
sudo chown -R 1000:1000 backups/ uploads/
docker-compose up -d
```

## Updating the Application

### Rolling Update

```bash
# Pull latest code
git pull origin main

# Rebuild image
docker-compose build app

# Restart with zero downtime (if using replicas)
docker-compose up -d --no-deps --build app

# Or standard restart
docker-compose restart app
```

### Database Migrations

```bash
# Migrations run automatically on container start
# Manual migration if needed:
docker-compose exec app npm run db:push
```

## Uninstalling

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (WARNING: deletes all data)
docker-compose down -v

# Remove images
docker rmi healthtrixss-crm postgres:16-alpine
```

## Support & Documentation

- **Application Documentation**: See `replit.md`
- **CSV Import Guide**: Admin Console → Help → Migration Guide
- **API Documentation**: Available in application
- **Issue Reporting**: Contact your system administrator

## Security Checklist

Before deploying to production:

- [ ] Generated strong SESSION_SECRET (32+ bytes)
- [ ] Generated strong BACKUP_ENCRYPTION_KEY (32+ bytes)
- [ ] Generated strong DB_PASSWORD (24+ bytes)
- [ ] Configured TLS/SSL certificate
- [ ] Set up reverse proxy (nginx/Traefik)
- [ ] Configured firewall rules
- [ ] Disabled PostgreSQL external access
- [ ] Set up automated backups
- [ ] Configured log rotation
- [ ] Removed test user (testadmin@healthtrixss.com) if present
- [ ] Verified RBAC permissions
- [ ] Tested backup/restore workflow
- [ ] Set up monitoring/alerting
- [ ] Documented recovery procedures
- [ ] Reviewed audit logs

## License

See LICENSE file for details.
