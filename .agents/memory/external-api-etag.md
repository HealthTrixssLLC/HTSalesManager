---
name: External API ETag concurrency
description: Durable contract for stale-write protection on external PATCH endpoints
---
- The stale-write contract only holds if EVERY write path to a versioned entity advances its version monotonically. A plain `new Date()` / `NOW()` assignment to updated_at can move it backward after rapid writes and resurrect an old ETag — completion review rejects any mutation path (admin flows, merges, backfills, conversions included) that skips the monotonic bump.
- **Why:** the version token is derived from updated_at, so any write that doesn't strictly advance it lets a stale If-Match satisfy the precondition and silently overwrite another actor's change.
- **How to apply:** when adding any new mutation for accounts/contacts/leads/opportunities/activities, reuse the shared monotonic-bump expression; If-Match parsing is strict (blank or malformed headers, or any malformed list member, fail the precondition rather than being ignored).
