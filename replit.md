# Health Trixss CRM

## Overview

Health Trixss CRM is a self-hosted CRM platform for healthcare professionals, offering sales pipeline management, automation, and analytics. It aims to streamline operations, manage customer relationships, and provide tailored business intelligence for the healthcare industry, serving as a lightweight alternative to larger CRM solutions.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system uses a full-stack JavaScript architecture: Node.js with Express for the backend, PostgreSQL with Drizzle ORM for the database, and React with Vite for the frontend.

**UI/UX Decisions (CR002 Brand-aligned):**
The design follows the official HealthTrixss Design System (https://healthtrixss-style-guide.replit.app/). Key design decisions:
- **Logo**: Official H+ mark (`/ht-logo.png`) — "H" in charcoal, "+" in orange — used in sidebar header and login page
- **Brand name**: "HealthTrixss" (single word, no space)
- **Primary brand color**: Dark Blue `#2E456B` / `hsl(216, 40%, 30%)` — used for primary buttons, icon squares, sidebar
- **Accent/CTA color**: Orange `#FEA002` / `hsl(39, 99%, 50%)` — focus ring, sidebar active items, secondary buttons, CTA highlights
- **Secondary/info color**: Dark Teal `#277493` / `hsl(195, 57%, 37%)` — demoted to chart-3, info states
- **Background**: Warm cream `#FAF7F2` / `hsl(38, 27%, 97%)` — the HealthTrixss brand "Background Light"
- **Font**: Inter + IBM Plex Sans, with JetBrains Mono for codes/IDs
- **Border radius**: `--radius: 0.5rem` (8px) — professional, not boxy
- **Sidebar**: Dark Blue gradient (`hsl(216,42%,18%)` → `hsl(216,38%,26%)`), white text 65% opacity inactive, orange-tinted pill on active
- **Cards**: White background, blue-tinted borders `hsl(216,20%,90%)`, blue-tinted box shadows
- **Login page**: Two-panel — left: dark blue gradient with H+ logo + feature highlights (orange icon boxes), right: white form
- **Typography scale**: H1=`text-3xl font-bold`, H2=`text-2xl font-semibold`, H3=`text-xl font-semibold` (style guide spec)
- **Badge colors**: Semantic per-entity (lead status/rating, opportunity stage, activity status/priority) with dark mode variants
- **Empty states**: Shared `EmptyState` component with blue icon square, title, description, CTA button
- **Shadows**: Blue-tinted box shadows `hsl(216 30% 20% / ...)`
- **Page headers**: Consistent `text-2xl font-semibold` with `p-6` padding and `space-y-6` rhythm across all pages

**Technical Implementations & Feature Specifications:**

*   **Core CRM Entities**: Comprehensive CRUD operations and detail views for Accounts, Contacts, Leads, Opportunities, and Activities, including related entities and a comments system.
*   **Lead Management**: Features a lead rating system (Hot/Warm/Cold), streamlined lead conversion via slide-out Sheet panel (replaces multi-step wizard dialog).
*   **Activity Management**: Supports bulk operations (reassignment, due date changes), real-time summary statistics, and a pending activities dashboard card with list/calendar views.
*   **Authentication & Authorization**: Custom JWT-based authentication with bcrypt hashing and a Role-Based Access Control (RBAC) framework (Admin, SalesManager, SalesRep, ReadOnly).
*   **Opportunity Management**: Kanban board for pipeline visualization and a Sales Waterfall Dashboard for annual target tracking. **All opportunities require a close date** (NOT NULL constraint enforced at database level). Includes **Implementation Start/End Date** fields for implementation planning and an **`opportunity_resources`** join table for assigning users with roles (e.g., "Product Developer", "Architect") to opportunities. A **Resource Allocation** page (`/resource-allocation`) provides Pipeline Timeline (Gantt-style bars by stage) and Resource Timeline (grouped by user) views with date range and user/stage filtering.
*   **Data Management**: Includes configurable ID patterns, comprehensive audit logging, encrypted backup/restore, CSV import/export with validation and deduplication, and specialized Dynamics 365 migration tools.
*   **Admin Console**: Centralized management for users, roles, ID patterns, backups, database reset, configurable account categories, and API Access Logs viewer with filtering and CSV export for debugging external API calls.
*   **Dashboard & Analytics**: Provides key insights like pipeline status, win rates, and forecasts. Features an OKR-driven analytics platform with multiple forecasting models, Pipeline Health Score, Sales Velocity, Rep Performance, Deal Closing Predictions, an Executive Dashboard, and sales forecast reports with Excel export capabilities.
*   **Comments & Tagging**: Full-featured threaded commenting with reactions and RBAC, and a multi-tagging system across all entities with custom colors and bulk operations.
*   **Saved Filter Presets**: Per-user named filter presets on all 5 list pages (Opportunities, Accounts, Contacts, Leads, Activities). Users can save current filter state, set one preset as default (auto-applied on page load), apply presets with one click, rename, and delete via dropdown context menu. Stored in `saved_filters` table (PostgreSQL jsonb). Backend: `GET/POST/PUT/DELETE /api/saved-filters`. Frontend: `SavedFiltersBar` component with badge chips, save dialog, and inline rename.
*   **External API for Forecasting**: Secure RESTful API endpoints (`/api/v1/external`) for custom forecasting app integration. Features include:
    *   **API Key Authentication**: Crypto-based 64-byte Base64-encoded keys with bcrypt hashing (12 rounds), stored as hashed values, shown only once at creation
    *   **Rate Limiting**: Per-key configurable rate limiting (default 100 req/min, configurable via `rateLimitPerMin` column) using express-rate-limit
    *   **Comprehensive Audit Logging**: Production-ready compliance logging capturing ALL API access (success/failure) with detailed metadata. Logs authentication attempts (`external_api_auth_success`/`external_api_auth_failure`), request/response data (`external_api_request_success`/`external_api_request_failure`), rate limits (429), client disconnects (499 with `aborted` flag), error details, response sizes (capped at 1MB), latency, IP addresses, and user agents. Fire-and-forget logging for zero performance impact.
    *   **Data Endpoints**: Five REST endpoints for accounts, opportunities, and audit logs (list/detail) with pagination, incremental sync (`updatedSince`), relationship expansion, and forecast filtering
    *   **Programmatic Log Access**: GET /api/v1/external/logs endpoint for automated debugging and monitoring with API key authentication (filtered by API key for security)
    *   **Admin Console Integration**: API key management with generation, revocation, activity tracking, configuration, and API Access Logs viewer with filtering and CSV export
    *   **Developer Documentation**: Complete INTEGRATION_GUIDE.md covering setup, authentication, all endpoints, debugging, error handling, rate limiting, best practices, and code examples in Node.js, Python, and cURL
*   **Performance Optimization**: Over 20 database indexes, optimized dashboard queries, N+1 query problem resolution for tags using PostgreSQL JSON aggregation, and cross-driver compatibility fixes for database results.
*   **Error Logging & Debugging**: Comprehensive error logging across all API routes and database methods for rapid diagnosis.
*   **Microsoft Entra ID SSO**: OAuth 2.0 authorization code flow via `server/entra-auth.ts`. Three routes: `GET /api/auth/entra/login` (builds Microsoft authorize URL dynamically), `GET /api/auth/entra/callback` (exchanges code, finds/creates local CRM user, issues 8-hour JWT cookie, redirects to `/auth?token=xxx`), `GET /api/auth/entra/me` (returns user profile). Env vars: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`. Auth page shows "Sign in with Microsoft" button. On callback the token is stored in `localStorage` as `entra_token` and cleared on logout. **Access control is CRM admin-controlled** — auto-provisioning is disabled; callback enforces three checks: (1) email must exist in CRM, (2) account status must be "active", (3) at least one role must be assigned. All SSO events (`sso_login_success`, `sso_login_rejected`) are written to the audit log with reason, IP, and user agent. Users with both local and Entra accounts on the same email share one CRM record.
*   **Security Hardening**: Production-grade security features protecting all 117 API endpoints:
    *   **CSRF Protection**: Double-submit cookie pattern with crypto-generated tokens, timing-safe comparison, and automatic frontend token management. Exempts login/register and external API routes.
    *   **Tiered Rate Limiting**: IPv4/IPv6 compatible throttling across all routes (configurable via `DISABLE_RATE_LIMITING=true` environment variable for self-hosted/Docker deployments):
        - Authentication routes: 10 req/min (login, register, logout, password reset)
        - Sensitive admin routes: 50 req/min (user management, backups, API keys, database operations)
        - CRUD operations: 300 req/min (all POST/PUT/PATCH/DELETE endpoints)
        - Read operations: 600 req/min (all GET endpoints including dashboards, analytics, exports)
    *   **CSV Security**: Header length validation (10KB max) prevents loop bound injection DoS attacks in Dynamics 365 migration tools
    *   All security measures validated against CodeQL static analysis findings

*   **CRM Workflow UX Overhaul**: Apple-inspired workflow improvements across all detail pages:
    *   **Global Quick-Add**: "+" button in sidebar header opens a Sheet with tabs for creating Account, Contact, Lead, Opportunity, or Activity from anywhere. Component: `client/src/components/global-quick-add.tsx`
    *   **Relationship Chain Bar**: Breadcrumb-style bar on detail pages showing entity hierarchy (e.g., Account > Contact > Opportunity). Component: `client/src/components/relationship-chain-bar.tsx`
    *   **Streamlined Lead Conversion**: Single-panel Sheet with toggle switches replaces 4-step wizard dialog. Opens inline from lead detail page instead of navigating away. Component: `client/src/components/lead-conversion-wizard.tsx`
    *   **Rich Related Object Cards**: Related entity items show avatar initials with entity-type colors, subtitle info, badges, and chevron-right navigation. Component: `client/src/components/related-entities-section.tsx`
    *   **Quick-Log Activity**: "Log Activity" button in detail page header opens compact Sheet form for fast activity creation, pre-linked to the current entity. Component: `client/src/components/quick-log-activity.tsx`

**System Design Choices:**

*   **Database Schema**: Comprises 17+ tables for authentication, RBAC, CRM entities, comments, and system configurations.
*   **Security**: Emphasizes strong secrets, production environment checks, CSRF protection, comprehensive rate limiting, and regular security audits.

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
*   **Encryption**: OpenSSL
*   **Deployment**: Docker, Replit