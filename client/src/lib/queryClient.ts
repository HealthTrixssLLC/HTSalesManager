import { QueryClient, QueryFunction } from "@tanstack/react-query";

const CSRF_COOKIE_NAME = "csrf_token";

/**
 * Reads the CSRF token directly from document.cookie.
 */
function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(CSRF_COOKIE_NAME + "="));
  return match ? match.split("=")[1] : null;
}

/**
 * Ensures a CSRF cookie exists by calling /api/csrf-token if needed.
 */
export async function fetchCsrfToken(): Promise<string> {
  let token = getCsrfTokenFromCookie();
  if (token) return token;

  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch CSRF token");

  token = getCsrfTokenFromCookie();
  if (!token) throw new Error("CSRF token cookie not set after fetch");

  return token;
}

export function resetCsrfToken() {
  // Nothing to reset - cookie is source of truth
}

/** Get active org ID from localStorage */
function getActiveOrgId(): string | null {
  try {
    return localStorage.getItem("activeOrgId");
  } catch {
    return null;
  }
}

/**
 * Paths that must NOT receive X-Organization-Id header.
 * These are bootstrap/global endpoints used to recover org context;
 * sending a stale org header to them would cause a 403 lockout.
 */
const ORG_AGNOSTIC_PATHS: string[] = [
  "/api/user/organizations",
  "/api/user",
  "/api/login",
  "/api/register",
  "/api/csrf-token",
  "/api/logout",
];

function isOrgAgnosticPath(url: string): boolean {
  return ORG_AGNOSTIC_PATHS.some(p => url === p || url.startsWith(p + "?") || url.startsWith(p + "/"));
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};

  // Inject active org header for org-scoped endpoints (skip bootstrap/global paths)
  const orgId = getActiveOrgId();
  if (orgId && !isOrgAgnosticPath(url)) {
    headers["X-Organization-Id"] = orgId;
  }

  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) &&
    url !== "/api/login" &&
    url !== "/api/register"
  ) {
    try {
      const token = await fetchCsrfToken();
      headers["X-CSRF-Token"] = token;
    } catch (error) {
      console.error("Failed to get CSRF token for request:", error);
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const orgId = getActiveOrgId();
    const headers: Record<string, string> = {};
    if (orgId && !isOrgAgnosticPath(url)) {
      headers["X-Organization-Id"] = orgId;
    }

    const res = await fetch(url, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
