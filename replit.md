# Health Trixss CRM

## Overview

Health Trixss CRM is a comprehensive, self-hosted CRM platform designed for healthcare professionals. It offers a lightweight alternative to larger CRM solutions, providing robust sales pipeline management, automation, and insightful analytics. The platform aims to streamline operations for sales teams, manage customer relationships, and provide actionable business intelligence tailored for the healthcare industry.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system is built on a full-stack JavaScript architecture using Node.js with Express for the backend, PostgreSQL with Drizzle ORM for the database, and React with Vite for the frontend.

**UI/UX Decisions:**
The design system is inspired by Linear, featuring a clean, professional enterprise SaaS aesthetic with consistent spacing, Inter font typography, subtle interactions, and balanced information density. The primary branding color is Health Trixss Teal (`hsl(186, 78%, 32%)`), complemented by a light teal accent (`hsl(186, 45%, 95%)`) and a multi-color palette for data visualization.

**Technical Implementations & Feature Specifications:**

*   **Core CRM Entities**: Accounts, Contacts, Leads, Opportunities, and Activities with dedicated CRUD pages and detail views. Entity detail pages include full information display, related entities, a comments system, and navigation.
*   **Lead Rating System**: Leads include a rating field (Hot/Warm/Cold) with full CRUD support in create/edit forms and filtering capabilities on the leads list page.
*   **Activity Management**: 
    *   **Bulk Operations**: Multi-select with checkboxes, bulk reassignment of owners, and bulk due date changes via dedicated dialogs.
    *   **Summary Statistics**: Real-time dashboard cards showing Total Activities, By Status (pending/completed/cancelled), Overdue (high priority), and Due This Week (meetings/calls). Statistics update automatically after any activity changes.
    *   **Date Handling**: Consistent string-based date handling (YYYY-MM-DD format) for activity due dates with proper form validation.
*   **Authentication & Authorization**: Custom JWT-based authentication with bcrypt hashing and a Role-Based Access Control (RBAC) framework (Admin, SalesManager, SalesRep, ReadOnly).
*   **Lead Management**: Multi-step Lead Conversion Wizard with duplicate detection.
*   **Opportunity Management**: Kanban board for pipeline management and a Sales Waterfall Dashboard for annual sales target tracking.
*   **Configurable ID Patterns**: Custom ID generation engine supporting dynamic patterns and configurable starting values.
*   **Audit Logging**: Comprehensive audit trail for all data mutations with before/after JSON diffs.
*   **Data Management**:
    *   **Backup & Restore**: Encrypted database snapshots with checksum verification.
    *   **CSV Import/Export**: Data migration toolkit with template downloads, validation, type coercion, custom ID preservation, and automatic deduplication based on `externalId` or `id`.
    *   **Dynamics 365 Migration Tools**: Specialized transformation tools in the Admin Console for migrating Accounts, Contacts, Leads, and Activities from Dynamics 365, including enriched fields, structured addresses, automatic linking, governance metadata, and smart ID generation.
*   **Admin Console**: Centralized management for users, roles, ID patterns, backup/restore, database reset, and configurable account categories.
*   **Help & Migration Guide**: Comprehensive documentation including a Dynamics 365 migration guide.
*   **Dashboard**: Provides key insights like pipeline status, win rates, and upcoming opportunity forecasts. Features a Sales Waterfall chart for annual target tracking and an Upcoming Opportunities by Close Date chart showing pipeline forecast by time period (next 6 months) with both opportunity counts and total values displayed on dual Y-axes.
*   **Analytics & Forecasting System**: OKR-driven analytics platform with four forecasting models, a Pipeline Health Score, Sales Velocity Metrics, Rep Performance Analytics, Deal Closing Predictions, and an Executive Dashboard. Includes 7 API endpoints and interactive visualizations using Recharts.
*   **Sales Forecast Reports** (Nov 2025): Excel export system accessible from Dashboard with comprehensive pipeline analytics. Generates `.xlsx` files with three tabs: (1) Opportunity Details with full opportunity data including account info, stage, amounts, close dates, and probabilities; (2) Executive Summary with key metrics (total pipeline value, win rate, average deal size), stage breakdown visualization data, and monthly trend data; (3) Monthly Forecast table showing opportunity counts, total values, and probability-weighted forecasts by month. Supports optional filtering by account, lead rating (hot/warm/cold), and date range. Download triggered via dialog with shadcn Select filters and date pickers. API endpoint: `GET /api/reports/sales-forecast` with query parameters for `accountId`, `rating`, `startDate`, and `endDate`.
*   **Comments System**: Full-featured threaded commenting with emoji reactions, pin/resolve status, edit/delete capabilities, and RBAC-enforced permissions for Accounts, Contacts, Leads, and Opportunities.
*   **Tagging System**: Multi-tag support across all entities (Accounts, Contacts, Leads, Opportunities) with clickable filter cards, custom colors, and bulk tag operations.
*   **Performance Optimization**: 
    *   Over 20 database indexes on frequently queried columns
    *   Optimized dashboard aggregation queries
    *   **Tag Loading Optimization** (Nov 2025): Eliminated N+1 query problem by using PostgreSQL JSON aggregation with LEFT JOIN in entity list queries. Tags are now included directly in the main entity response (`getAllAccounts`, `getAllContacts`, `getAllLeads`, `getAllOpportunities`) using `json_agg` and `FILTER` clauses, reducing hundreds of individual tag API calls to a single query per entity type.
        *   **Cross-Driver Compatibility Fix** (Nov 2025): Fixed critical data fetching issue where standard PostgreSQL driver and Neon serverless driver return different result formats. Standard pg driver returns `{rows, rowCount, ...}` object while Neon returns array directly. All `db.execute()` calls now normalize results using `Array.isArray(result) ? result : result?.rows ?? []` pattern to ensure compatibility across both environments.
    *   **Error Logging & Debugging Infrastructure** (Nov 2025): Added comprehensive error logging to all entity API routes and database methods. Logs include full error messages, stack traces, and query execution details with prefixed labels `[ACCOUNTS-ROUTE]`, `[CONTACTS-ROUTE]`, `[LEADS-ROUTE]`, `[OPPORTUNITIES-ROUTE]`, `[DB-ACCOUNTS]`, `[DB-CONTACTS]`, `[DB-LEADS]`, `[DB-OPPORTUNITIES]` for easy identification. This enables rapid diagnosis of issues in both development and production environments.
        *   **Docker SQL Column Name Fix** (Nov 2025): Fixed critical bug where entity list queries failed in Docker deployment with error "column et.entity_type does not exist". The `entity_tags` table schema uses `entity` (not `entity_type`) as the column name. Updated all four entity queries (`getAllAccounts`, `getAllContacts`, `getAllLeads`, `getAllOpportunities`) to use correct column reference `et.entity` instead of `et.entity_type` in JOIN conditions. This ensures compatibility between Replit/Neon and Docker/standard PostgreSQL environments.
        *   **Activity Association Fix** (Nov 2025): Fixed critical bug where activities associated with entities (accounts, contacts, leads, opportunities) weren't appearing on entity detail pages. The system has both deprecated `relatedType`/`relatedId` fields and a proper `activity_associations` many-to-many table. Updated `POST /api/activities` to automatically create `activity_associations` entries when activities are created with `relatedType`/`relatedId`. Updated all entity detail endpoints (`/api/accounts/:id/related`, `/api/contacts/:id/related`, `/api/leads/:id/related`, `/api/opportunities/:id/related`) to query BOTH the deprecated fields AND the `activity_associations` table, merging and deduplicating results. This ensures backward compatibility while supporting the proper association architecture.
        *   **Contact Name Display Fix** (Nov 2025): Fixed bug where contact names appeared as "undefined undefined" in searchable dropdowns. The `getAllContacts` SQL query was using `c.*` with `GROUP BY c.id`, which didn't properly return all columns when combined with tag aggregation. Updated query to explicitly list all columns with proper snake_case to camelCase aliasing (`first_name` → `firstName`, `last_name` → `lastName`, etc.) and include all columns in the `GROUP BY` clause, ensuring reliable field extraction alongside tag aggregates.
        *   **Create Activity Form Fix** (Nov 2025): Fixed critical bug where Create Activity form failed validation. The form was defaulting optional fields (`ownerId`, `notes`) to empty strings (`""`) instead of `null`, causing backend Zod schema validation failures. Additionally, the `completedAt` field wasn't marked as optional in the form schema and was missing from default values, causing "Required" validation errors. Updated form schema to extend both `dueAt` AND `completedAt` as optional union fields, added `completedAt: null` to both defaultValues and reset() calls, ensured form schema omits auto-generated `id` field using `.omit({ id: true })`, and fixed `onActivitySubmit` handler to properly convert empty date strings to `null` before sending to API. This ensures activities can be created successfully with backend auto-generated IDs (e.g., "ACV-2025-00042").

**System Design Choices:**

*   **Database Schema**: 17+ tables covering authentication, RBAC, CRM entities, comments, and system configurations.
*   **Development Workflow**: `npm run dev` for development, `npm run db:push` for migrations.
*   **Security**: Emphasizes strong secrets, production environment checks, and regular security audits.

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
*   **Encryption**: OpenSSL (for secrets and AES-256-GCM for backups)
*   **Deployment**: Docker, Replit