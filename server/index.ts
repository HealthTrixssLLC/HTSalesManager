import express, { type Request, Response, NextFunction } from "express";
import http from "http";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDefaultRolesAndPermissions } from "./rbac";
import { initializeDefaultOrganization, runStartupColumnMigration } from "./seed";
import { storage, fixEntityTagsEntityNames } from "./db";
import { csrfProtection, generateCsrfToken } from "./csrf-protection";

// Set default BACKUP_ENCRYPTION_KEY for development if not already set
if (!process.env.BACKUP_ENCRYPTION_KEY) {
  process.env.BACKUP_ENCRYPTION_KEY = "dev-backup-key-2025-healthtrixss-crm-secure";
  console.log("Using default BACKUP_ENCRYPTION_KEY for development");
}

const app = express();

// Trust proxy for accurate IP addresses (needed for Replit)
app.set("trust proxy", true);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
// Use raw body parser for backup restore endpoint
// Accepts both legacy .htb (application/octet-stream) and new .zip (application/zip) uploads
app.use("/api/admin/restore", express.raw({ type: ["application/octet-stream", "application/zip"], limit: "200mb" }));

// Standard JSON and URL-encoded parsers for other routes
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// CSRF protection is properly implemented via csrfProtection middleware below
// codeql[js/missing-token-validation] - cookieParser is secured by custom double-submit cookie pattern (see csrf-protection.ts)
// CSRF validation applied to all state-changing requests (POST/PUT/PATCH/DELETE) on line 41
app.use(cookieParser());

// CSRF protection middleware - validates tokens on state-changing requests
// Custom implementation using double-submit cookie pattern (see csrf-protection.ts)
app.use(csrfProtection);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const port = parseInt(process.env.PORT || '5000', 10);
  const httpServer = http.createServer(app);

  // Lightweight liveness probe — no DB access, no auth required.
  // Must be registered before serveStatic's SPA catch-all to remain reachable.
  // In production this is the primary target for Replit's autoscale health check.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (app.get("env") !== "development") {
    // Production: bind the port immediately — before the init chain — so the
    // Replit autoscale health check can succeed within ~100 ms of process start.
    //
    // During the init window (~5-6 s) /health returns 200 immediately.
    // API routes are unavailable until registerRoutes() completes; unauthenticated
    // API requests receive 404. The static frontend is served after serveStatic()
    // is registered at the bottom of this function (after registerRoutes).
    // This is safe: clients cannot authenticate until auth routes are registered.
    httpServer.listen(port, "0.0.0.0", () => {
      log(`Health Trixss CRM serving on http://0.0.0.0:${port}`);
    });
  }

  // ── Init chain ────────────────────────────────────────────────────────────
  // Order and content of every step below is unchanged from before.
  // In production the server is already listening above; in development the
  // server has not yet started listening (setupVite + listen come last).
  // ─────────────────────────────────────────────────────────────────────────

  // Run schema column migration FIRST — adds any missing organization_id columns
  // and creates organizations/user_organizations tables if absent in production.
  // Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS so it is fully idempotent.
  await runStartupColumnMigration();

  // Initialize default roles and permissions
  await initializeDefaultRolesAndPermissions();
  
  // Initialize default ID patterns
  await storage.initializeIdPatterns();
  console.log("ID patterns initialized");
  
  // Initialize default organization (multi-tenant support)
  await initializeDefaultOrganization();
  console.log("Organization initialized");
  
  // Fix any entity_tags rows with wrong entity name format
  await fixEntityTagsEntityNames();
  
  // CSRF token endpoint - generates and returns token for frontend
  app.get("/api/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });
  
  // Register API routes
  await registerRoutes(app);
  
  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Setup Vite (dev) or static file serving (prod) — always AFTER registerRoutes
  // so that the SPA catch-all does not shadow API routes.
  if (app.get("env") === "development") {
    await setupVite(app, httpServer);
    // Development: listen here, after Vite attaches its WebSocket upgrade
    // handlers to httpServer. Startup delay is acceptable in dev (no autoscale).
    httpServer.listen(port, "0.0.0.0", () => {
      log(`Health Trixss CRM serving on http://0.0.0.0:${port}`);
    });
  } else {
    // Production: static serving registered after API routes (correct order).
    // The server is already listening (bound above before the init chain).
    serveStatic(app);
  }
})();
