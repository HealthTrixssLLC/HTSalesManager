# Health Trixss CRM

## Overview

Health Trixss CRM is a comprehensive, self-hosted CRM platform designed for healthcare professionals. It serves as a lightweight alternative to larger CRM solutions, providing robust sales pipeline management, automation, and insightful analytics tailored for the healthcare industry. The platform aims to streamline operations for sales teams, manage customer relationships effectively, and provide actionable business intelligence.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system is built on a full-stack JavaScript architecture using Node.js with Express for the backend, PostgreSQL with Drizzle ORM for the database, and React with Vite for the frontend.

**UI/UX Decisions:**
The design system is inspired by Linear, focusing on a clean, professional enterprise SaaS aesthetic suitable for healthcare. It features consistent spacing, Inter font typography, subtle interactions, and a balanced information density. The primary branding color is Health Trixss Teal (`hsl(186, 78%, 32%)`), complemented by a light teal accent (`hsl(186, 45%, 95%)`) and a multi-color palette for data visualization in charts.

**Technical Implementations & Feature Specifications:**

*   **Core CRM Entities**: Accounts, Contacts, Leads, Opportunities, and Activities form the foundation, each with dedicated CRUD pages and comprehensive detail views.
    *   **Entity Detail Pages**: All entities feature dedicated detail pages (e.g., `/accounts/:id`) with:
        *   Full entity information display with formatted fields
        *   Related entities sections showing connections (e.g., Account → Contacts, Opportunities, Activities)
        *   Integrated comments system for collaboration
        *   Back navigation to list pages
        *   Edit/delete action buttons (handlers pending implementation)
        *   Consistent UI using shared DetailPageLayout and RelatedEntitiesSection components
        *   Clickable navigation from all list pages to detail pages
*   **Authentication**: A custom authentication system independent of Replit Auth, utilizing JWT and bcrypt for password hashing (10 rounds).
*   **Authorization**: A custom Role-Based Access Control (RBAC) framework with roles (Admin, SalesManager, SalesRep, ReadOnly) and deny-by-default permissions.
*   **Lead Management**: Features a multi-step Lead Conversion Wizard with duplicate detection.
*   **Opportunity Management**: Includes a Kanban board for drag-and-drop pipeline management and a Sales Waterfall Dashboard for tracking annual sales targets by year, visualizing pipeline stages, and identifying gaps to target.
*   **Configurable ID Patterns**: A custom ID generation engine supports patterns like `{PREFIX}`, `{YYYY}`, `{SEQ:n}`, and configurable starting values per entity.
*   **Audit Logging**: Comprehensive audit trail for all data mutations, including before/after JSON diffs.
*   **Data Management**:
    *   **Backup & Restore**: Encrypted database snapshots (AES-256-GCM) with checksum verification, allowing import/export via the Admin Console.
    *   **CSV Import/Export**: Complete data migration toolkit with template downloads, validation, and type coercion for imports. **Custom ID Preservation**: During CSV import, existing record IDs from external systems (e.g., Dynamics 365) are preserved exactly as provided, ensuring downstream systems and integrations continue to work without modifications. Leave ID column empty for auto-generation.
    *   **Dynamics 365 Account Import**: Specialized transformation tool in Admin Console for migrating Dynamics 365 account data with 17 enriched account fields:
        *   **Structured Address Fields**: billingStreet/City/State/PostalCode, shippingStreet/City/State/PostalCode for proper address handling
        *   **Account Metadata**: accountNumber (external system ID), category, industry classification
        *   **Primary Contact Integration**: primaryContactName, primaryContactEmail for key stakeholder tracking
        *   **Governance & Traceability**: externalId (Dynamics GUID), sourceSystem, sourceRecordId, importStatus, importNotes for audit trail
        *   Excel file upload with configurable sheet name
        *   JSON-based column mapping configuration (maps Dynamics columns like "(Do Not Modify) Account", "HT Account Number", "Business Type", "Category")
        *   Smart ID generation: preserves existing Account Numbers or generates new IDs using patterns like `ACC-{{YYYY}}{{MM}}-{{00001}}`
        *   Type mapping (e.g., "Customer" → "customer" for enum compatibility)
        *   Comprehensive validation (email, phone, URL formats)
        *   Deduplication based on Account Name + Account Number with configurable fuzzy matching (default 90% threshold)
        *   Governance metadata injection preserves Dynamics GUID as sourceRecordId for downstream integrations
        *   Template-aligned CSV output for seamless import into CRM
        *   Complete user guide: `DYNAMICS_IMPORT_GUIDE.md`
        *   Files: `server/dynamics-mapper.ts`, API endpoint `/api/admin/dynamics/transform-accounts`, config: `attached_assets/dynamics_mapping_config.json`
*   **Admin Console**: Centralized management for users, roles, ID patterns, backup/restore, and database reset functionality.
    *   **User Management**: Inline editing of user attributes (name, email, role) with role dropdown selector
    *   **Role Assignment**: Admins can view and modify user roles directly from the Users tab
    *   **Account Categories**: Admin-configurable categories for account classification with CRUD operations via `/api/admin/categories` endpoints. Categories feature name, description, color, isActive flag, and displayOrder. Account create/edit forms use dropdown populated from active categories instead of free-text input
*   **Help & Migration Guide**: Comprehensive documentation including a guide for migrating data from Dynamics 365.
*   **Dashboard**: Provides key insights such as pipeline status, win rates, and user activity summaries.
*   **Analytics & Forecasting System**: OKR-driven analytics platform measuring outcomes and drivers, not activities:
    *   **Revenue Forecasting**: Four forecasting models (stage-weighted, historical win rate, velocity-based, time-decay) providing conservative, most likely, and commit forecasts
    *   **Pipeline Health Score**: Composite score (0-100) based on coverage, stage distribution, velocity, and freshness with actionable recommendations
    *   **Sales Velocity Metrics**: Real-time pipeline velocity ($/day), stage conversion rates, and bottleneck identification
    *   **Rep Performance Analytics**: Rankings by revenue, win rate, efficiency, with coaching insights and at-risk rep identification
    *   **Deal Closing Predictions**: AI-enhanced predictions of which deals will close when, based on historical patterns and time decay
    *   **Executive Dashboard**: Revenue vs target tracking, win rate trends, average deal size, sales cycle analysis
    *   **API Endpoints**: 7 analytics endpoints (`/api/analytics/forecast`, `/velocity`, `/pipeline-health`, `/rep-performance`, `/predictions`, `/historical`, `/conversions`)
    *   **Interactive Visualizations**: Multi-tab dashboard using Recharts for trends, funnels, and performance rankings
*   **Comments System**: Full-featured commenting on Accounts, Contacts, Leads, and Opportunities with:
    *   Threaded comments (max depth 2) with reply functionality
    *   Emoji reactions (👍❤️🎉👀🚀) with user tracking
    *   Pin/Resolve status for important or completed discussions
    *   Edit (15-minute window) and delete (owner-only) capabilities
    *   Thread subscriptions for notifications (schema ready, MVP)
    *   Batch-loaded queries to prevent N+1 performance issues
    *   RBAC-enforced permissions: Admin (all), SalesManager (all), SalesRep (read/create/update/react), ReadOnly (read)
*   **Performance Optimization**: Includes over 20 database indexes on frequently queried columns and optimized dashboard aggregation queries.

**System Design Choices:**

*   **Database Schema**: Comprises 17+ tables covering authentication, RBAC, CRM entities, comments, and system configurations (e.g., `audit_logs`, `id_patterns`, `comments`, `comment_reactions`, `comment_attachments`, `comment_subscriptions`).
*   **Development Workflow**: Utilizes `npm run dev` for development, `npm run db:push` for migrations, and supports Docker, Replit Production, and manual VPS/Cloud deployments.
*   **Security**: Emphasizes strong secrets for `SESSION_SECRET` and `BACKUP_ENCRYPTION_KEY`, production environment checks, and regular security audits.

## External Dependencies

*   **Database**: PostgreSQL 16+
*   **Backend Framework**: Node.js 20+ with Express
*   **ORM**: Drizzle ORM
*   **Frontend Framework**: React with Vite
*   **UI Components**: Shadcn components
*   **Authentication Hashing**: bcrypt
*   **JWT Handling**: jsonwebtoken
*   **CSV Parsing**: csv-parse
*   **Excel File Processing**: xlsx
*   **File Uploads**: Multer
*   **Data Validation**: Zod
*   **Encryption**: OpenSSL (for generating secrets and AES-256-GCM for backups)
*   **Deployment**: Docker, Replit (via `.replit` and `replit.nix` configurations)

## Production Deployment

The application is production-ready with multiple deployment options:

### Deployment Methods

1. **Docker (Self-Hosted)**: Use `docker-compose up -d` with the provided `docker-compose.yml` configuration. Includes PostgreSQL 16, health checks, and automatic restarts.
   - **Windows Users**: The Dockerfile creates the entrypoint script internally during build, eliminating any line ending (CRLF/LF) issues. No manual file conversion needed.

2. **Replit Production**: Click "Deploy" in Replit UI. Environment variables (`SESSION_SECRET`, `BACKUP_ENCRYPTION_KEY`) are managed via Replit Secrets.

3. **Manual VPS/Cloud**: Deploy to AWS, GCP, Azure, or DigitalOcean. Run `npm install && npm run db:push && npm run dev` with environment variables set.

### Environment Variables

See `.env.example` for all required environment variables. Critical production secrets:
- `SESSION_SECRET`: JWT signing key (generate with `openssl rand -base64 32`)
- `BACKUP_ENCRYPTION_KEY`: AES-256-GCM encryption key for backups (generate with `openssl rand -base64 32`)
- `DATABASE_URL`: PostgreSQL connection string
- `NODE_ENV=production`

### Post-Deployment Steps

1. **Register first user** (automatically gets Admin role **if no other Admin users exist in database**)
   - For fresh deployments: First user registered becomes Admin
   - For databases with existing users: Check if Admin users exist before registering
   - Use Admin Console → Users to assign Admin role manually if needed
2. Configure ID patterns in Admin Console
3. Create additional users and assign roles
4. Import data via CSV Import page (if migrating from Dynamics 365)
5. Set annual sales targets in Dashboard

### Test Credentials (Development Only)

For testing purposes, a test admin user exists in development:
- **Email**: testadmin@healthtrixss.com
- **Password**: testpass123
- **Role**: Admin

**IMPORTANT**: Remove this user in production deployments.

### Performance & Security

- **Database Indexes**: 20+ indexes on foreign keys, search fields, and frequently queried columns across all major tables
- **Encryption**: AES-256-GCM for backup files with SHA-256 checksum verification
- **Authentication**: JWT-based with bcrypt password hashing (10 rounds)
- **RBAC**: Deny-by-default permissions with resource.action pattern
- **Audit Logging**: Complete trail of all data mutations with before/after JSON diffs

### Monitoring & Backups

- Health check endpoint: `GET /api/user` (requires authentication)
- Automated backups via Admin Console with encrypted `.htcrm` files
- Audit logs accessible in Admin Console for security review
- Database performance optimized with indexed queries