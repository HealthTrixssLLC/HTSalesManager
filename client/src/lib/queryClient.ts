import { QueryClient, QueryFunction } from "@tanstack/react-query";

const CSRF_COOKIE_NAME = "csrf_token";

/**
 * Reads the CSRF token directly from document.cookie.
 * The server sets a readable (non-httpOnly) cookie so JS can mirror it in the header —
 * this is the standard Double Submit Cookie pattern.
 */
function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(CSRF_COOKIE_NAME + "="));
  return match ? match.split("=")[1] : null;
}

/**
 * Ensures a CSRF cookie exists by calling /api/csrf-token if needed,
 * then returns the token value from the cookie.
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

/** Force a fresh CSRF cookie on next mutation (call after login/logout). */
export function resetCsrfToken() {
  // Nothing to reset in memory — the cookie is the source of truth.
  // The next call to fetchCsrfToken will re-fetch from the server if cookie is missing.
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
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
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
