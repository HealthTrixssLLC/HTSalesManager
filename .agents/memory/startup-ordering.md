---
name: Startup ordering constraint
description: setupVite and serveStatic both register SPA catch-alls that shadow later routes; registerRoutes must precede both. Production-only early listen pattern for health checks.
---

# Startup ordering constraint

## The rule
`setupVite(app, httpServer)` and `serveStatic(app)` both register `app.use("*", ...)` catch-alls that intercept **every** unmatched request and return index.html. Any route registered after these catch-alls will never be reached. Therefore `registerRoutes(app)` must always run **before** either function is called.

**Why:** Express matches middleware/routes in registration order. The `"*"` wildcard in both Vite and serveStatic catch-alls consumes the request and sends a response, so `next()` is never called for later-registered routes.

**How to apply:** When restructuring startup order, keep this invariant:
```
registerRoutes(app)     ← must come first
errorHandler middleware  ← must come second
setupVite / serveStatic  ← must come last
```

## Production early-listen pattern (autoscale health check fix)

To make the port available before the init chain (so Replit's autoscale health check can succeed), bind the port **before** the init chain in production only:

```typescript
// Register /health first (before any catch-all)
app.get("/health", (_req, res) => res.json({ status: "ok" }));

if (app.get("env") !== "development") {
  httpServer.listen(port, "0.0.0.0", callback); // ← production only, before init
}

await runStartupColumnMigration();
// ... rest of init chain, unchanged order ...
await registerRoutes(app);
app.use(errorHandler);

if (app.get("env") === "development") {
  await setupVite(app, httpServer);
  httpServer.listen(port, "0.0.0.0", callback); // ← dev: listen last, after Vite
} else {
  serveStatic(app); // ← prod: static after routes, server already listening
}
```

**Why dev is different:** `setupVite` is async and attaches WebSocket upgrade handlers to `httpServer`. It must be called before `listen()` in dev (Vite HMR relies on the upgrade handler). In prod `serveStatic` is synchronous and has no such requirement.

**During the production init window (~5-6 s):**
- `GET /health` → 200 immediately
- `GET /api/*` → 404 (no routes yet) — acceptable for brief window
- `GET /` → 404 until serveStatic registers after init
- Replit health check probes the port → receives a response (not ECONNREFUSED) → instance marked healthy
