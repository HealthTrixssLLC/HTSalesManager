# Health Trixss CRM

## Overview

Health Trixss CRM is a self-hosted CRM platform designed for healthcare professionals. Its primary purpose is to streamline operations, manage customer relationships, and provide tailored business intelligence. Key capabilities include sales pipeline management, automation, and analytics, offering a lightweight alternative to larger CRM solutions while focusing on the specific needs of the healthcare industry.

## User Preferences

I want iterative development. Ask before making major changes. I prefer detailed explanations. Do not make changes to the folder `Requirements-CPDO`. Do not make changes to the file `design_guidelines.md`.

## System Architecture

The system utilizes a full-stack JavaScript architecture. The backend is built with Node.js and Express, interacting with a PostgreSQL database via Drizzle ORM. The frontend is developed using React with Vite.

**UI/UX Decisions:**
The design adheres to the official HealthTrixss Design System, incorporating specific brand elements:
- **Logo**: Official H+ mark (`/ht-logo.png`)
- **Brand Name**: "HealthTrixss"
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
*   **Data Management**: Features configurable ID patterns, audit logging, encrypted backup/restore, CSV import/export with validation, and Dynamics 365 migration tools.
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

**System Design Choices:**
The database schema comprises over 32 tables. Security emphasizes strong secrets, production environment checks, CSRF protection, comprehensive rate limiting, and regular security audits.

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