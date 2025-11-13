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
*   **Opportunity Management**: Kanban board for pipeline visualization and a Sales Waterfall Dashboard for annual target tracking.
*   **Data Management**: Includes configurable ID patterns, comprehensive audit logging, encrypted backup/restore, CSV import/export with validation and deduplication, and specialized Dynamics 365 migration tools.
*   **Admin Console**: Centralized management for users, roles, ID patterns, backups, database reset, and configurable account categories.
*   **Dashboard & Analytics**: Provides key insights like pipeline status, win rates, and forecasts. Features an OKR-driven analytics platform with multiple forecasting models, Pipeline Health Score, Sales Velocity, Rep Performance, Deal Closing Predictions, an Executive Dashboard, and sales forecast reports with Excel export capabilities.
*   **Comments & Tagging**: Full-featured threaded commenting with reactions and RBAC, and a multi-tagging system across all entities with custom colors and bulk operations.
*   **External API for Forecasting**: Secure RESTful API endpoints (`/api/v1/external`) for custom forecasting app integration, featuring API Key authentication with rate limiting, comprehensive audit logging, and specific endpoints for accounts and opportunities with pagination and incremental sync capabilities. Integrated Admin Console management for API keys and comprehensive developer documentation.
*   **Performance Optimization**: Over 20 database indexes, optimized dashboard queries, N+1 query problem resolution for tags using PostgreSQL JSON aggregation, and cross-driver compatibility fixes for database results.
*   **Error Logging & Debugging**: Comprehensive error logging across all API routes and database methods for rapid diagnosis.

**System Design Choices:**

*   **Database Schema**: Comprises 17+ tables for authentication, RBAC, CRM entities, comments, and system configurations.
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
*   **Encryption**: OpenSSL
*   **Deployment**: Docker, Replit