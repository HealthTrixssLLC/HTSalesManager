# Health Trixss CRM

A comprehensive, self-hosted CRM platform built for healthcare professionals. This lightweight Salesforce alternative provides powerful sales pipeline management, automation, and insights.

## Project Overview

**Stack**: Full-stack JavaScript (Node.js + Express + PostgreSQL + React + Vite)
**Design System**: Linear-inspired enterprise SaaS with Health Trixss teal branding
**Authentication**: Custom auth system (independent from Replit Auth)
**Database**: PostgreSQL with Drizzle ORM

## Key Features (MVP)

### Core CRM Entities
- **Accounts** - Customer organizations and companies
- **Contacts** - Individual business contacts
- **Leads** - Potential customers with conversion workflow
- **Opportunities** - Sales deals with Kanban board visualization
- **Activities** - Calls, emails, meetings, tasks, and notes

### Advanced Features
- **Lead Conversion Wizard** - Multi-step wizard with duplicate detection
- **Opportunity Kanban Board** - Drag-and-drop pipeline management
- **Configurable ID Patterns** - Custom ID generation with tokens ({PREFIX}, {YYYY}, {SEQ:n})
- **Custom RBAC Framework** - Role-based access control (Admin, SalesManager, SalesRep, ReadOnly)
- **Audit Logging** - Complete audit trail with before/after diffs
- **Dashboard** - Pipeline insights, win rate, activities by user
- **Admin Console** - User/role management, ID pattern config, backup/restore, database reset
- **Backup & Restore** - Export/import database snapshots with encryption

## Project Structure

```
/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   │   ├── ui/         # Shadcn components
│   │   │   ├── app-sidebar.tsx
│   │   │   └── lead-conversion-wizard.tsx
│   │   ├── hooks/          # Custom React hooks
│   │   │   └── use-auth.tsx
│   │   ├── lib/            # Utilities
│   │   │   ├── protected-route.tsx
│   │   │   └── queryClient.ts
│   │   ├── pages/          # Page components
│   │   │   ├── auth-page.tsx
│   │   │   ├── dashboard.tsx
│   │   │   ├── accounts-page.tsx
│   │   │   ├── contacts-page.tsx
│   │   │   ├── leads-page.tsx
│   │   │   ├── opportunities-page.tsx
│   │   │   ├── activities-page.tsx
│   │   │   ├── admin-console.tsx
│   │   │   └── audit-log-page.tsx
│   │   ├── App.tsx         # Main app with routing
│   │   └── index.css       # Global styles & design tokens
│   └── index.html
├── server/                 # Express backend (TO BE IMPLEMENTED)
│   ├── routes.ts           # API routes
│   ├── storage.ts          # Storage interface
│   ├── db.ts              # Database connection
│   └── index.ts           # Server entry point
├── shared/                 # Shared types and schemas
│   └── schema.ts           # Drizzle schema & Zod types
├── Requirements-CPDO/      # CPDO requirement documents
└── design_guidelines.md    # Design system documentation
```

## Database Schema

### Auth & RBAC Tables
- `users` - User accounts with custom authentication
- `roles` - Role definitions (Admin, SalesManager, SalesRep, ReadOnly)
- `permissions` - Permission definitions (resource.action pattern)
- `user_roles` - Junction table for user-role assignments
- `role_permissions` - Junction table for role-permission assignments

### CRM Entity Tables
- `accounts` - Customer accounts with configurable IDs
- `contacts` - Business contacts linked to accounts
- `leads` - Lead capture with conversion tracking
- `opportunities` - Sales opportunities with stages and pipeline
- `activities` - Activity timeline (calls, emails, meetings, tasks, notes)

### System Tables
- `audit_logs` - Complete audit trail with before/after JSON diffs
- `id_patterns` - Configurable ID generation patterns per entity
- `backup_jobs` - Backup/restore job tracking with status

## Color Scheme (Health Trixss Branding)

- **Primary**: Teal `hsl(186, 78%, 32%)` - Medical trust and professionalism
- **Accent**: Light teal `hsl(186, 45%, 95%)` - Clean healthcare aesthetic
- **Charts**: Multi-color palette for data visualization

## Current Progress

### ✅ Task 1: Schema & Frontend (COMPLETED)
- [x] Complete database schema with 13+ tables
- [x] Health Trixss teal color branding applied
- [x] Custom authentication components (login/register)
- [x] Protected route wrapper
- [x] useAuth hook for authentication state
- [x] Sidebar navigation with app shell
- [x] Dashboard with stat cards and charts
- [x] All CRUD pages (Accounts, Contacts, Leads, Opportunities, Activities)
- [x] Lead Conversion Wizard (multi-step with duplicate detection)
- [x] Opportunity Kanban board with stage management
- [x] Admin Console (Users, Roles, ID Patterns, Backup/Restore, Database Reset)
- [x] Audit Log viewer with expandable diffs
- [x] Beautiful loading states, empty states, error handling

### ✅ Task 2: Backend (COMPLETED)
- [x] PostgreSQL database migration with 13+ tables
- [x] Custom authentication with JWT and password hashing (bcrypt 10 rounds)
- [x] Custom RBAC middleware with deny-by-default permissions
- [x] ID Pattern Engine with atomic counters and pattern tokens
- [x] All API endpoints for CRUD operations with validation
- [x] Lead conversion workflow with duplicate detection
- [x] Dashboard aggregation queries for stats and charts
- [x] Audit logging for all mutations with before/after diffs
- [x] Backup/restore service with AES-256-GCM encryption and checksum verification
- [x] Database reset functionality preserving system configuration

### 📋 Task 3: Integration, Polish & Testing
- [ ] Connect frontend to backend APIs
- [ ] Test core user journeys
- [ ] Docker configuration
- [ ] Replit deployment config
- [ ] Final polish and architect review

## Design Philosophy

This CRM follows a **Linear-inspired enterprise SaaS design system** with:
- Clean, professional aesthetic suitable for healthcare
- Consistent spacing and typography (Inter font throughout)
- Subtle interactions with hover/active states
- Information density balanced with readability
- Teal color scheme for medical trust and professionalism

## Deployment

### Docker (Local/Self-Hosted)
```bash
docker-compose up
```

### Replit Production
Configured via `.replit` and `replit.nix` files.

## Development

```bash
# Install dependencies
npm install

# Run database migrations
npm run db:push

# Start development server
npm run dev
```

## User Roles & Permissions

- **Admin**: Full system access including user/role management, ID patterns, backups
- **SalesManager**: Manage all CRM entities, view reports, assign leads
- **SalesRep**: Create/edit own records, convert leads, manage pipeline
- **ReadOnly**: View-only access to CRM data

## ID Pattern Examples

- Accounts: `ACCT-2025-00001`
- Contacts: `CONT-2501-00001`
- Leads: `LEAD-000001`
- Opportunities: `OPP-2025-000001`
- Activities: `ACT-2501-00001`

All patterns are configurable via Admin Console using tokens like `{PREFIX}`, `{YYYY}`, `{YY}`, `{MM}`, `{SEQ:n}`.

## Recent Changes

- **2025-10-31**: Completed Backup & Restore implementation
  - Built BackupService with AES-256-GCM encryption and gzip compression
  - Embedded SHA-256 checksum in backup files for integrity verification
  - Created restore service with data validation and dependency-order restoration
  - Implemented database reset preserving system configuration
  - Added file download/upload UI in Admin Console
  - Fixed LSP errors and schema field name mismatches
- **2025-01-XX**: Initial project setup with complete frontend and schema
  - Created comprehensive database schema with 13+ tables
  - Implemented all frontend pages with Health Trixss branding
  - Built Lead Conversion Wizard and Opportunity Kanban board
  - Created Admin Console with system management features
