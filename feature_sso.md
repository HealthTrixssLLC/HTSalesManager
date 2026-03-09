# Microsoft Entra ID SSO — COMPLETE

All tasks implemented and E2E verified.

## Access Control Policy (CRM Admin-controlled)

Auto-provisioning is **disabled**. The callback enforces three checks in sequence:

1. **Email must exist in the CRM** — if not, rejected with "Your account has not been set up. Contact your administrator."
2. **Account must be active** — status `inactive` or `suspended` → rejected with "Your account has been suspended."
3. **At least one CRM role must be assigned** — no roles → rejected with "Your account has no permissions assigned."

CRM admins pre-create user accounts (with the user's Microsoft email) in the Admin Console. The user's CRM role assignments determine what they can do — Microsoft only verifies *who* they are.

## Audit Logging

All SSO events are written to the audit log (`storage.createAuditLog`):
- `sso_login_success` — includes roles list, IP, user agent
- `sso_login_rejected` — includes reason (`account_not_found` | `account_not_active` | `no_roles_assigned`), IP, user agent

## Account Merging

A user with both a local password account and an Entra ID account using the **same email** signs into the **same CRM user record**. No duplicate accounts are created. They can log in via either method interchangeably.

## Azure Portal Setup

Two redirect URIs must be registered in Azure App Registration → Authentication → Web:
- Dev: `https://<replit-dev-url>/api/auth/entra/callback`
- Production: `https://htsalesmanager.healthtrixss.com/api/auth/entra/callback`

## Completed Tasks

- [x] T1 — Backend Entra auth module (`server/entra-auth.ts`)
- [x] T2 — Backend route registration (`server/routes.ts`)
- [x] T3 — Frontend: token handling + Microsoft button (`client/src/pages/auth-page.tsx`)
- [x] T4 — Frontend: logout clears localStorage token (`client/src/hooks/use-auth.tsx`)
- [x] T5 — Access control: remove auto-provisioning, add status + role checks
- [x] T6 — Audit logging for SSO login success and rejection events
