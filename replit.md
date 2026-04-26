# Health Trixss CRM

## Overview

Health Trixss CRM is a self-hosted CRM platform designed for healthcare professionals. Its primary purpose is to streamline operations, manage customer relationships, and provide tailored business intelligence. Key capabilities include sales pipeline management, automation, and analytics, offering a lightweight alternative to larger CRM solutions while focusing on the specific needs of the healthcare industry.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system utilizes a full-stack JavaScript architecture. The backend is built with Node.js and Express, interacting with a PostgreSQL database via Drizzle ORM. The frontend is developed using React with Vite.

**UI/UX Decisions:**
The design adheres to the official Health Trixss Design System, incorporating specific brand elements:
- **Logo**: Official H+ mark (`/ht-logo.png`)
- **Brand Name**: "Health Trixss"
- **Color Palette**: Primary Dark Blue (`#2E456B`), Accent Orange (`#FEA002`), Secondary Dark Teal (`#277493`), and Background Warm Cream (`#FAF7F2`).
- **Typography**: Inter and IBM Plex Sans, with JetBrains Mono for code.
- **Components**: Utilizes a consistent border radius, dark blue gradient sidebar, white cards with blue-tinted borders, and a two-panel login page.
- **Standardized Elements**: Includes semantic badge colors, a shared `EmptyState` component, blue-tinted box shadows, and consistent page header styling.

**Technical Implementations & Feature Specifications:**

*   **Core CRM Entities**: Comprehensive CRUD operations, detail views, related entities, and a comments system for Accounts, Contacts, Leads, Opportunities, and Activities.
*   **Lead Management**: Features a lead rating system (Hot/Warm/Cold) and streamlined lead conversion via a slide-out Sheet panel.
*   **Activity Management**: Supports bulk operations, real-time statistics, and a pending activities dashboard with list/calendar views.
*   **Authentication & Authorization**: Custom JWT-based authentication with bcrypt hashing and Role-Based Access Control (RBAC) supporting roles like Admin, SalesManager, SalesRep, ReadOnly, and ProductDeveloper. Microsoft Entra ID SSO is also integrated.
*   **Opportunity Management**: Includes a Kanban board, Sales Waterfall Dashboard, required close dates, Implementation Start/End Dates, and an `opportunity_resources` join table for user assignments. A Resource Allocation page provides Pipeline and Resource Timeline views.
*   **Data Management**: Features configurable ID patterns, audit logging, encrypted backup/restore (ZIP format including all uploaded document files, with backward-compatible support for legacy .htb and v2.0.0 backups), CSV import/export with validation, and Dynamics 365 migration tools. Backup is now v2.1.0 and includes `organizations` and `userOrganizations` tables. Restoring older backups (v1.x, v2.0.0) strips `organizationId` from CRM records gracefully; server startup backfills them automatically.
*   **Admin Console**: Centralized management for users, roles, ID patterns, backups, database reset, account categories, and API Access Logs.
*   **Dashboard & Analytics**: Provides key insights like pipeline status, win rates, forecasts, an OKR-driven analytics platform, various forecasting models, and sales forecast reports.
*   **Comments & Tagging**: Threaded commenting with reactions and RBAC, and a multi-tagging system with custom colors.
*   **Resource Allocation**: Workforce planning page utilizing the `opportunity_resources` table for tracking user assignments with roles, allocation, and date ranges.
*   **Saved Filter Presets**: Per-user named filter presets for all list pages, allowing users to save, apply, and manage their filter configurations.
*   **External API for Forecasting**: Secure RESTful API endpoints (`/api/v1/external`) with API Key Authentication, per-key rate limiting, comprehensive audit logging, and specific data endpoints for accounts, opportunities, and logs.
*   **Performance Optimization**: Incorporates numerous database indexes, optimized dashboard queries, N+1 query problem resolution, and cross-driver compatibility fixes.
*   **Error Logging & Debugging**: Comprehensive error logging across API routes and database methods.
*   **Security Hardening**: Implements CSRF protection, tiered rate limiting across all routes, and CSV security measures, with all security validated against CodeQL findings.
*   **CRM Workflow UX Overhaul**: Includes Global Quick-Add, a Relationship Chain Bar, Streamlined Lead Conversion, Rich Related Object Cards, and Quick-Log Activity features for an enhanced user experience.
*   **Lead Generation Module**: A self-contained module for lead generation with its own data model (15 new tables), API routes (`/api/lead-gen/...`), RBAC for access control, an approval flow for lead creation, and dedicated frontend pages for dashboard, ICP management, playbooks, runs, review queue, candidate details, and reports.
*   **Research Document Storage System**: A `research_documents` table stores AI-generated and manual research documents attached to candidate and CRM records (7 entity types). CRUD API endpoints at `/api/documents`. When a candidate is approved, all associated research documents are automatically copied to the new CRM lead record. A `ResearchDocumentsPanel` component is embedded on Lead, Account, Contact, and Opportunity detail pages, and on the Candidate Detail page (as a "Research Docs" tab). Users can add manual notes and delete documents from any CRM entity page.
*   **Multi-Tenant Organization Support**: CRM is multi-tenant with `organizations` and `user_organizations` tables (schema.ts). Each user belongs to one or more orgs with an org-level role (resolved via user_organizations.roleId → roles.name). An OrgProvider context (client/src/contexts/org-context.tsx) manages the active org with a persistent localStorage preference. An OrgSwitcher in the sidebar header lets users switch orgs instantly, invalidating all cached queries. An Organizations admin tab in the Admin Console (client/src/components/admin/organizations-tab.tsx) lets Admins manage orgs and members. The RBAC middleware (server/rbac.ts) checks org-level roles in addition to global user_roles, with global Admin as a system-level override. The dashboard annual sales target is stored in org settings and editable by org Admins only. X-Organization-Id header is injected by the frontend on every API request so the backend can identify the active org. All CRM data (accounts, contacts, leads, opportunities, activities, ICP profiles, playbooks, lead-gen runs) is scoped by organizationId. Admin tables (llmConfigurations, apiKeys) are also org-scoped; idPatterns and accountCategories are global shared resources that serve as defaults for all orgs. The authenticate middleware auto-resolves the user's default org if no X-Organization-Id header is sent. CSV imports, lead conversion, and bulk updates all stamp the active organizationId on new records. System-level admin routes (org CRUD, global role management) require a global Admin role enforced by requireGlobalRole middleware.

**System Design Choices:**
The database schema comprises over 32 tables. Security emphasizes strong secrets, production environment checks, CSRF protection, comprehensive rate limiting, and regular security audits.

**Database Migration Strategy:**
This project uses `drizzle-kit push` (`npm run db:push`) for schema management rather than migration files. Schema changes are applied directly to the database by pushing the Drizzle schema. The server startup (`server/seed.ts` → `initializeDefaultOrganization`) runs an idempotent backfill for all CRM records that lack an `organizationId`, and is safe to run repeatedly.

For deploying the multi-tenant schema to an **existing pre-multi-tenant database**, the recommended sequence is:
1. Run `npx tsx scripts/migrate-org-scoping.ts` — backfills all null `organizationId` values to the default org (idempotent, safe to re-run).
2. Run `npm run db:push` — applies the `NOT NULL` constraints on `organizationId` columns.
3. Start the server normally — `initializeDefaultOrganization()` will handle any remaining setup.

## External Dependencies

*   **Database**: PostgreSQL 16+
*   **Backend Framework**: Node.js 20+
*   **Web Framework**: Express
*   **ORM**: Drizzle ORM
*   **Frontend Framework**: React
*   **Build Tool**: Vite
*   **UI Components**: Shadcn
*   **Authentication Hashing**: bcrypt
*   **JWT Handling**: jsonwebtoken
*   **CSV Parsing**: csv-parse
*   **Excel File Processing**: xlsx
*   **File Uploads**: Multer
*   **Data Validation**: Zod
*   **Encryption**: OpenSSL
*   **Deployment**: Docker, Replit