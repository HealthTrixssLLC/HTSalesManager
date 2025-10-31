# Health Trixss CRM

A comprehensive Salesforce-lite CRM application with custom RBAC, audit logging, lead conversion workflow, and admin console.

## Features

- **Custom Authentication**: JWT-based authentication with bcrypt password hashing
- **Role-Based Access Control (RBAC)**: Custom RBAC framework with deny-by-default permissions
- **Lead Management**: Capture, track, and convert leads to accounts, contacts, and opportunities
- **Lead Conversion Wizard**: Multi-step wizard for converting leads with duplicate detection
- **Opportunity Kanban**: Visual board for managing opportunity stages
- **Dashboard**: Real-time stats with Pipeline by Stage and Activities by User charts
- **Admin Console**: User/role management, ID pattern configuration, backup/restore, database reset
- **Audit Logging**: Complete audit trail of all system changes with before/after diffs
- **ID Pattern Engine**: Configurable ID patterns with atomic counters (e.g., LEAD-2025-0001)

## Technology Stack

- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS + Shadcn UI
- **Backend**: Express.js + Node.js 20 + TypeScript
- **Database**: PostgreSQL 16 with Drizzle ORM
- **Authentication**: Custom JWT + bcryptjs
- **Charts**: Recharts

## Deployment

### Replit Production

The application is already configured for Replit deployment:

1. Click the **Deploy** button in Replit
2. Replit will automatically:
   - Run `npm run build` to build the application
   - Run `npm run start` to start the production server
   - Expose the app on port 80 (mapped from internal port 5000)

Environment variables are managed automatically by Replit (DATABASE_URL, SESSION_SECRET, etc.)

### Docker Deployment

Build and run with Docker Compose:

```bash
# Set environment variables (optional)
export DB_PASSWORD=your_secure_password
export SESSION_SECRET=your_secure_session_secret

# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The application will be available at `http://localhost:5000`

### Manual Deployment

Requirements:
- Node.js 20+
- PostgreSQL 16+

```bash
# Install dependencies
npm install

# Set environment variables
export DATABASE_URL=postgresql://user:password@localhost:5432/healthtrixss_crm
export SESSION_SECRET=your_secure_session_secret
export NODE_ENV=production

# Build the application
npm run build

# Seed the database with default roles
npx tsx server/seed.ts

# Start the production server
npm run start
```

## Default Roles & Permissions

The system comes with 4 pre-configured roles:

1. **Admin** - Full access (wildcard `*.*` permission)
2. **Sales Manager** - 22 permissions (manage all sales entities)
3. **Sales Rep** - 16 permissions (create and manage own records)
4. **Read Only** - 5 permissions (read-only access)

**First User**: The first registered user automatically receives Admin role.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secret key for JWT token signing
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 5000)

## Database Seeding

To seed the database with default roles and permissions:

```bash
npx tsx server/seed.ts
```

This creates:
- 4 default roles (Admin, SalesManager, SalesRep, ReadOnly)
- 44 total permissions across all resources
- 8 default ID patterns for entities

## Development

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5000`

## Architecture

- **Frontend**: Single-page application with React Router (wouter)
- **Backend**: RESTful API with Express.js
- **Database**: Relational schema with 13+ tables
- **Authentication**: JWT tokens stored in httpOnly cookies
- **RBAC**: Custom middleware with resource.action permission pattern
- **Audit Logging**: Automatic logging of all mutations with IP address and user agent

## Security Features

- Password hashing with bcrypt (10 rounds)
- JWT tokens with 7-day expiration
- httpOnly cookies (XSS protection)
- CSRF protection with sameSite cookies
- SQL injection protection via Drizzle ORM
- Deny-by-default RBAC permissions
- Audit logging for compliance

## License

Copyright © 2025 Health Trixss. All rights reserved.
