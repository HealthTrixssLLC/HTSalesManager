import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RelatedEntitiesSection } from "@/components/related-entities-section";
import type { Opportunity } from "@shared/schema";

vi.mock("@/hooks/use-financial-access", () => ({
  useFinancialAccess: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { useFinancialAccess } from "@/hooks/use-financial-access";

const mockUseFinancialAccess = vi.mocked(useFinancialAccess);

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-test-001",
    organizationId: "org-001",
    accountId: "acct-001",
    name: "FinTest Deal Q4",
    stage: "Proposal",
    amount: "125000.00",
    closeDate: new Date("2026-12-31"),
    ownerId: null,
    probability: null,
    status: null,
    actualCloseDate: null,
    actualRevenue: null,
    estCloseDate: null,
    estRevenue: null,
    rating: null,
    externalId: null,
    sourceSystem: null,
    sourceRecordId: null,
    importStatus: null,
    importNotes: null,
    includeInForecast: true,
    implementationStartDate: null,
    implementationEndDate: null,
    categories: null,
    operationalAreas: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Contact page: Related Opportunities financial visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("restricted roles — opportunity amount should be hidden", () => {
    it("shows em-dash instead of dollar amount for ReadOnly role", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      const oppCard = screen.getByTestId("related-opportunities-opp-test-001");
      expect(oppCard).toBeInTheDocument();
      expect(oppCard).toHaveTextContent("—");
      expect(oppCard).not.toHaveTextContent("$125,000.00");
      expect(oppCard).not.toHaveTextContent("125,000");
    });

    it("does not show dollar amounts when canViewFinancials is false (ProductDeveloper/Resource)", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      expect(screen.queryByText("$125,000.00")).not.toBeInTheDocument();
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("authorized roles — opportunity amount should be visible", () => {
    it("shows formatted dollar amount for Admin role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      const oppCard = screen.getByTestId("related-opportunities-opp-test-001");
      expect(oppCard).toBeInTheDocument();
      expect(oppCard).toHaveTextContent("$125,000.00");
      expect(oppCard).not.toHaveTextContent("—");
    });

    it("shows formatted dollar amount for SalesManager role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      expect(screen.getByText("$125,000.00")).toBeInTheDocument();
    });

    it("shows formatted dollar amount for SalesRep role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      const oppCard = screen.getByTestId("related-opportunities-opp-test-001");
      expect(oppCard).toHaveTextContent("$125,000.00");
      expect(oppCard).not.toHaveTextContent("—");
    });

    it("shows formatted dollar amount for Reviewer role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      const oppCard = screen.getByTestId("related-opportunities-opp-test-001");
      expect(oppCard).toHaveTextContent("$125,000.00");
      expect(oppCard).not.toHaveTextContent("—");
    });
  });

  describe("opportunity title always visible regardless of role", () => {
    it("always shows opportunity name for restricted roles", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      expect(screen.getByText("FinTest Deal Q4")).toBeInTheDocument();
    });

    it("always shows opportunity name for authorized roles", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity()]}
          entityType="opportunities"
        />
      );

      expect(screen.getByText("FinTest Deal Q4")).toBeInTheDocument();
    });
  });

  describe("opportunity with no amount", () => {
    it("shows nothing for amount when opportunity has no amount and user has access", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <RelatedEntitiesSection
          title="Opportunities"
          entities={[makeOpportunity({ amount: null })]}
          entityType="opportunities"
        />
      );

      expect(screen.queryByText("$")).not.toBeInTheDocument();
    });
  });
});
