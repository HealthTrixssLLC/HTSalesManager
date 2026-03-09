# Microsoft Entra ID SSO — Implementation Plan

## Overview

Add Microsoft Entra ID (formerly Azure AD) SSO authentication alongside the existing username/password system. Uses OAuth 2.0 authorization code flow. Env vars `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` are already configured.

**Architecture decision**: The Entra callback finds-or-creates a local CRM user by email, then issues a standard 8-hour JWT as an HTTP-only cookie (same pattern as existing login). It also redirects to `/auth?token=<jwt>` so the frontend can store the token in `localStorage` per spec. This avoids modifying the dozens of custom `fetch` calls scattered across list and detail pages — they all work automatically with the existing cookie-based auth.

---

## Tasks

- [ ] **T1 — Backend: Entra auth route module** (`server/entra-auth.ts`)
  - `GET /api/auth/entra/login` — builds Microsoft authorize URL using `x-forwarded-proto` / `x-forwarded-host` headers, generates a random CSRF `state`, stores it in a short-lived cookie, redirects to `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize` with scopes `openid profile email User.Read`
  - `GET /api/auth/entra/callback` — validates state, exchanges authorization code for tokens at the Microsoft token endpoint, fetches user profile from `https://graph.microsoft.com/v1.0/me`, finds or creates a local CRM user by email (default role: SalesRep), generates an 8-hour JWT with SESSION_SECRET, sets it as an HTTP-only cookie, then redirects to `/auth?token=<jwt>`
  - `GET /api/auth/entra/me` — verifies the Bearer token and returns the user profile (uses existing `authenticate` middleware)

- [ ] **T2 — Backend: Register Entra routes** (`server/routes.ts`)
  - Import and mount the 3 Entra routes before any catch-all handlers
  - Exempt callback from CSRF middleware (it's a GET redirect from Microsoft, not a state-changing API call)

- [ ] **T3 — Frontend: Auth page — token handling + Microsoft button** (`client/src/pages/auth-page.tsx`)
  - On mount, read `?token=` query parameter; if present, store in `localStorage` as `entra_token` and redirect to `/`
  - Add a "Sign in with Microsoft" button that navigates to `/api/auth/entra/login`
  - Show the button below the existing login form with a visual separator

- [ ] **T4 — Frontend: Logout clears localStorage token** (`client/src/hooks/use-auth.tsx`)
  - In `logoutMutation.onSuccess`, also call `localStorage.removeItem('entra_token')` so the SSO token is cleared on sign-out
  - Reset CSRF token cache to force re-fetch after re-login

## QA Checklist

- [ ] Clicking "Sign in with Microsoft" redirects to Microsoft login page (correct tenant, client_id, redirect_uri, scopes)
- [ ] After completing Microsoft login, user is redirected to `/auth?token=xxx`, then immediately to `/` (dashboard)
- [ ] `localStorage.getItem('entra_token')` contains a valid JWT after the flow
- [ ] The logged-in user's name appears in the sidebar
- [ ] Clicking "Log out" clears both the cookie and localStorage token and returns to `/auth`
- [ ] Direct navigation to a protected route while unauthenticated redirects to `/auth`
- [ ] Existing username/password login still works unchanged
