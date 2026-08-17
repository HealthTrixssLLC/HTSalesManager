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
  // Registered first so it is never intercepted by the startup gate or
  // any SPA catch-all registered later.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (app.get("env") !== "development") {
    // Production startup gate — active only while init is running.
    //
    // Once startupReady flips to true (set after serveStatic() below) this
    // middleware calls next() immediately and is permanently transparent.
    //
    // During the init window:
    //   GET /        → 200 {"status":"starting"}  (Replit health probe target)
    //   all others   → 503 {"status":"starting"}  (honest, not a misleading 404)
    let startupReady = false;

    app.use((req, res, next) => {
      if (startupReady) return next();
      if (req.method === "GET" && req.path === "/") {
        return res.status(200).json({ status: "starting" });
      }
      return res.status(503).json({ status: "starting" });
    });

    // Bind the port immediately so the probe above can respond within ~100 ms.
    httpServer.listen(port, "0.0.0.0", () => {
      log(`Health Trixss CRM serving on http://0.0.0.0:${port}`);
    });

    // Keep a reference so we can set it after full init completes.
    // Stored on the httpServer object to stay accessible in the production
    // branch at the bottom of this function without widening scope.
    (httpServer as any)._setStartupReady = () => { startupReady = true; };
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
    // Full init complete — release the startup gate so all requests pass through.
    (httpServer as any)._setStartupReady();
  }
})().catch((err: Error) => {
  // Ensure a failed init exits nonzero rather than leaving a permanently
  // false-healthy (listening but broken) instance.
  console.error("Fatal startup error:", err);
  process.exit(1);
});
