import { useAuth } from "@/hooks/use-auth";

const FINANCIAL_ROLE_NAMES = new Set(["Admin", "SalesManager", "SalesRep", "Reviewer"]);

export function useFinancialAccess(): boolean {
  const { user } = useAuth();
  if (!user || !user.roles || user.roles.length === 0) return false;
  return user.roles.some((role) => FINANCIAL_ROLE_NAMES.has(role.name));
}
