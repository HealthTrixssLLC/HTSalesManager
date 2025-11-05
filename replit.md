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
*   **Activity Bulk Operations**: Supports multi-select, bulk reassignment of owners, and bulk due date changes.
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
*   **Dashboard**: Provides key insights like pipeline status, win rates, and user activity summaries.
*   **Analytics & Forecasting System**: OKR-driven analytics platform with four forecasting models, a Pipeline Health Score, Sales Velocity Metrics, Rep Performance Analytics, Deal Closing Predictions, and an Executive Dashboard. Includes 7 API endpoints and interactive visualizations using Recharts.
*   **Comments System**: Full-featured threaded commenting with emoji reactions, pin/resolve status, edit/delete capabilities, and RBAC-enforced permissions for Accounts, Contacts, Leads, and Opportunities.
*   **Performance Optimization**: Over 20 database indexes on frequently queried columns and optimized dashboard aggregation queries.

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