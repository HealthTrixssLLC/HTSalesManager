/**
 * usePermissions — org-aware client-side mirror of the server RBAC model.
 *
 * Fetches effective permissions from GET /api/permissions?orgId=<activeOrgId>
 * so the values always reflect the role the server will actually enforce for
 * the current org.  When the user switches orgs the query key changes, which
 * triggers an automatic refetch — no manual invalidation needed.
 *
 * Exposes a `can(resource, action)` helper that honours the same wildcard rules
 * as server/rbac.ts:hasPermission:
 *   "*.*"            → Admin (all resources / all actions)
 *   "Resource.*"     → all actions on one resource
 *   "*.action"       → one action across all resources
 *   "Resource.action"→ exact match
 *
 * NOTE: This hook is for UI-element visibility only.  Server-side enforcement
 * is always authoritative — hiding a button is UX, not a security boundary.
 */
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/contexts/org-context";

export function usePermissions() {
  const { activeOrgId } = useOrg();

  const { data } = useQuery({
    // Include activeOrgId in the cache key so React Query refetches automatically
    // whenever the user switches organizations.
    queryKey: ["/api/permissions", activeOrgId ?? "global"],
    queryFn: async () => {
      const url = activeOrgId
        ? `/api/permissions?orgId=${encodeURIComponent(activeOrgId)}`
        : "/api/permissions";
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401) return { permissions: [] as string[] };
      if (!res.ok) throw new Error(`${res.status}: Failed to load permissions`);
      return res.json() as Promise<{ permissions: string[] }>;
    },
    // Keep data for 5 minutes; a queryKey change (org switch) resets this automatically.
    staleTime: 5 * 60 * 1000,
  });

  const permissions: string[] = data?.permissions ?? [];

  /**
   * Returns true if the current user has permission for resource + action in the active org.
   */
  const can = (resource: string, action: string): boolean => {
    if (permissions.includes("*.*")) return true;
    if (permissions.includes(`${resource}.*`)) return true;
    if (permissions.includes(`*.${action}`)) return true;
    return permissions.includes(`${resource}.${action}`);
  };

  return { can, permissions };
}
