import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * CSRF Token Management
 * Fetches and caches the CSRF token for use in state-changing requests
 */
let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  // Return cached token if available
  if (csrfToken) {
    return csrfToken;
  }

  try {
    const res = await fetch('/api/csrf-token', {
      credentials: 'include',
    });

    if (!res.ok) {
      throw new Error('Failed to fetch CSRF token');
    }

    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
    throw error;
  }
}

// Reset CSRF token cache (useful after login/logout)
export function resetCsrfToken() {
  csrfToken = null;
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

  // Include CSRF token for state-changing requests (not for login/register)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) &&
      url !== '/api/login' && url !== '/api/register') {
    try {
      const token = await fetchCsrfToken();
      headers['X-CSRF-Token'] = token;
    } catch (error) {
      console.error('Failed to get CSRF token for request:', error);
      // Continue without token - server will reject the request
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
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
