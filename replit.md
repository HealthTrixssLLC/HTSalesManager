# Health Trixss CRM

## Overview

Health Trixss CRM is a self-hosted CRM platform for healthcare professionals, offering sales pipeline management, automation, and analytics. It aims to streamline operations, manage customer relationships, and provide tailored business intelligence for the healthcare industry, serving as a lightweight alternative to larger CRM solutions.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system uses a full-stack JavaScript architecture: Node.js with Express for the backend, PostgreSQL with Drizzle ORM for the database, and React with Vite for the frontend.

**UI/UX Decisions:**
The design adheres to a clean, professional enterprise SaaS aesthetic inspired by Linear, featuring consistent spacing, Inter font typography, subtle interactions, and balanced information density. The primary brand color is Health Trixss Teal (`hsl(186, 78%, 32%)`), accented by a lighter teal (`hsl(186, 45%, 95%)`) and a multi-color palette for data visualization.

**Technical Implementations & Feature Specifications:**

*   **Core CRM Entities**: Comprehensive CRUD operations and detail views for Accounts, Contacts, Leads, Opportunities, and Activities, including related entities and a comments system.
*   **Lead Management**: Features a lead rating system (Hot/Warm/Cold), multi-step conversion wizard with duplicate detection.
*   **Activity Management**: Supports bulk operations (reassignment, due date changes), real-time summary statistics, and a pending activities dashboard card with list/calendar views.
*   **Authentication & Authorization**: Custom JWT-based authentication with bcrypt hashing and a Role-Based Access Control (RBAC) framework (Admin, SalesManager, SalesRep, ReadOnly).
*   **Opportunity Management**: Kanban board for pipeline visualization and a Sales Waterfall Dashboard for annual target tracking. **All opportunities require a close date** (NOT NULL constraint enforced at database level).
*   **Data Management**: Includes configurable ID patterns, comprehensive audit logging, encrypted backup/restore, CSV import/export with validation and deduplication, and specialized Dynamics 365 migration tools.
*   **Admin Console**: Centralized management for users, roles, ID patterns, backups, database reset, configurable account categories, and API Access Logs viewer with filtering and CSV export for debugging external API calls.
*   **Dashboard & Analytics**: Provides key insights like pipeline status, win rates, and forecasts. Features an OKR-driven analytics platform with multiple forecasting models, Pipeline Health Score, Sales Velocity, Rep Performance, Deal Closing Predictions, an Executive Dashboard, and sales forecast reports with Excel export capabilities.
*   **Comments & Tagging**: Full-featured threaded commenting with reactions and RBAC, and a multi-tagging system across all entities with custom colors and bulk operations.
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
*   **Security Hardening**: Production-grade security features protecting all 117 API endpoints:
    *   **CSRF Protection**: Double-submit cookie pattern with crypto-generated tokens, timing-safe comparison, and automatic frontend token management. Exempts login/register and external API routes.
    *   **Tiered Rate Limiting**: IPv4/IPv6 compatible throttling across all routes:
        - Authentication routes: 5 req/min (login, register, logout, password reset)
        - Sensitive admin routes: 20 req/min (user management, backups, API keys, database operations)
        - CRUD operations: 100 req/min (all POST/PUT/PATCH/DELETE endpoints)
        - Read operations: 200 req/min (all GET endpoints including dashboards, analytics, exports)
    *   **CSV Security**: Header length validation (10KB max) prevents loop bound injection DoS attacks in Dynamics 365 migration tools
    *   All security measures validated against CodeQL static analysis findings

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