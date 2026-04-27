import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFinancialAccess } from "@/hooks/use-financial-access";
import type { useAuth } from "@/hooks/use-auth";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: vi.fn(),
}));

import { useAuth as useAuthImport } from "@/hooks/use-auth";

const mockUseAuth = vi.mocked(useAuthImport);

type AuthReturn = ReturnType<typeof useAuth>;

function makeAuthReturn(roleNames: string[]): AuthReturn {
  return {
    user: {
      id: "test-user",
      email: "test@example.com",
      name: "Test User",
      password: "hashed",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      roles: roleNames.map((name, i) => ({
        id: `role-${i}`,
        name,
        description: null,
        createdAt: new Date(),
      })),
    },
    isLoading: false,
    error: null,
    loginMutation: undefined as never,
    logoutMutation: undefined as never,
    registerMutation: undefined as never,
  };
}

function makeNullAuthReturn(): AuthReturn {
  return {
    user: null,
    isLoading: false,
    error: null,
    loginMutation: undefined as never,
    logoutMutation: undefined as never,
    registerMutation: undefined as never,
  };
}

describe("useFinancialAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authorized roles — should return true", () => {
    it("returns true for Admin role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["Admin"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(true);
    });

    it("returns true for SalesManager role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["SalesManager"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(true);
    });

    it("returns true for SalesRep role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["SalesRep"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(true);
    });

    it("returns true for Reviewer role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["Reviewer"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(true);
    });
  });

  describe("restricted roles — should return false", () => {
    it("returns false for ReadOnly role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["ReadOnly"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(false);
    });

    it("returns false for ProductDeveloper role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["ProductDeveloper"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(false);
    });

    it("returns false for Resource role", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["Resource"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false when user is null", () => {
      mockUseAuth.mockReturnValue(makeNullAuthReturn());
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(false);
    });

    it("returns false when user has no roles", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn([]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(false);
    });

    it("returns true if user has at least one authorized role among others", () => {
      mockUseAuth.mockReturnValue(makeAuthReturn(["ReadOnly", "Admin"]));
      const { result } = renderHook(() => useFinancialAccess());
      expect(result.current).toBe(true);
    });
  });
});
