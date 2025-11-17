import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDefaultRolesAndPermissions } from "./rbac";
import { storage } from "./db";
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
app.use("/api/admin/restore", express.raw({ type: "application/octet-stream", limit: "50mb" }));

// Standard JSON and URL-encoded parsers for other routes
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// CSRF protection middleware - validates tokens on state-changing requests
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
  // Initialize default roles and permissions
  await initializeDefaultRolesAndPermissions();
  
  // Initialize default ID patterns
  await storage.initializeIdPatterns();
  console.log("ID patterns initialized");
  
  // CSRF token endpoint - generates and returns token for frontend
  app.get("/api/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
  });
  
  // Register API routes
  registerRoutes(app);
  
  // Error handling middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Create HTTP server
  const httpServer = await import("http").then((http) => http.createServer(app));

  // Setup Vite or static serving
  if (app.get("env") === "development") {
    await setupVite(app, httpServer);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = parseInt(process.env.PORT || '5000', 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`Health Trixss CRM serving on http://0.0.0.0:${port}`);
  });
})();
