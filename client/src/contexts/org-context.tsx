import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

export type OrgSettings = {
  annualSalesTargets?: Record<string, number>;
  [key: string]: unknown;
};

export type OrgWithRole = {
  id: string;
  userId: string;
  organizationId: string;
  roleId: string;
  isDefault: boolean;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    settings: OrgSettings;
    createdAt: string;
    updatedAt: string;
  };
  roleName: string;
};

type OrgContextType = {
  activeOrg: OrgWithRole["organization"] | null;
  activeOrgId: string | null;
  activeOrgRole: string | null;
  userOrgs: OrgWithRole[];
  isLoading: boolean;
  switchOrg: (orgId: string) => void;
  setDefaultOrg: (orgId: string) => void;
  isSettingDefault: boolean;
};

const OrgContext = createContext<OrgContextType | null>(null);

const LOCAL_STORAGE_KEY = "activeOrgId";

export function OrgProvider({ children }: { children: ReactNode }) {
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => {
    return localStorage.getItem(LOCAL_STORAGE_KEY);
  });

  const { data: userOrgs = [], isLoading } = useQuery<OrgWithRole[]>({
    queryKey: ["/api/user/organizations"],
    retry: false,
    staleTime: 60000,
  });

  // Resolve active org: prefer stored, fallback to default, fallback to first
  useEffect(() => {
    if (userOrgs.length === 0) return;
    const storedId = activeOrgId;
    const isValid = storedId && userOrgs.some(o => o.organizationId === storedId);
    if (!isValid) {
      const defaultOrg = userOrgs.find(o => o.isDefault) || userOrgs[0];
      const newId = defaultOrg?.organizationId || null;
      setActiveOrgId(newId);
      if (newId) localStorage.setItem(LOCAL_STORAGE_KEY, newId);
    }
  }, [userOrgs]);

  const switchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    localStorage.setItem(LOCAL_STORAGE_KEY, orgId);
    // Invalidate all org-scoped query data
    queryClient.invalidateQueries();
  }, []);

  const setDefaultOrgMutation = useMutation({
    mutationFn: async (orgId: string) => {
      await apiRequest("PUT", "/api/user/default-org", { organizationId: orgId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/organizations"] });
    },
  });

  const activeOrgEntry = activeOrgId ? userOrgs.find(o => o.organizationId === activeOrgId) : null;
  const activeOrg = activeOrgEntry?.organization || (userOrgs.length > 0 ? userOrgs[0]?.organization : null);
  const resolvedActiveOrgId = activeOrgEntry?.organizationId || (userOrgs.length > 0 ? userOrgs[0]?.organizationId : null) || null;

  return (
    <OrgContext.Provider value={{
      activeOrg,
      activeOrgId: resolvedActiveOrgId,
      activeOrgRole: activeOrgEntry?.roleName || null,
      userOrgs,
      isLoading,
      switchOrg,
      setDefaultOrg: (orgId: string) => setDefaultOrgMutation.mutate(orgId),
      isSettingDefault: setDefaultOrgMutation.isPending,
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
