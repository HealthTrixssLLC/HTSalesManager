---
name: External API authorization
description: Durable rules for permission scoping on the external (API-key) routes
---

Rule: every route registered on the external API router must have an explicit `requirePermission(...)` guard — reads need the `*.read` scope, mutations the matching `*.write` scope. Audit the route list after any merge — newly merged routes may arrive unguarded.

**Why:** unguarded routes are genuine authorization bypasses on externally reachable endpoints.

**How to apply:** grep `^router\.` in the external routes file and confirm each entry carries a guard; NULL permissions = legacy full access, but an empty array must mean zero scopes, never full access.
