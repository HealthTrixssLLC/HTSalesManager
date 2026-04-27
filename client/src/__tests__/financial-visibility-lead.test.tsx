import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConvertedOpportunityAmount } from "@/pages/lead-detail-page";
import type { Opportunity } from "@shared/schema";

vi.mock("@/hooks/use-financial-access", () => ({
  useFinancialAccess: vi.fn(),
}));

import { useFinancialAccess } from "@/hooks/use-financial-access";

const mockUseFinancialAccess = vi.mocked(useFinancialAccess);

type OpportunityAmountProps = Pick<Opportunity, "id" | "name" | "amount">;

function makeOpportunity(overrides: Partial<OpportunityAmountProps> = {}): OpportunityAmountProps {
  return {
    id: "opp-test-001",
    name: "FinTest Deal Q4",
    amount: "125000.00",
    ...overrides,
  };
}

const noop = () => {};

describe("Lead page: Converted opportunity amount financial visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("restricted roles — amount element must not appear in DOM", () => {
    it("hides the amount element for ReadOnly role (element not in DOM)", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(
        screen.queryByTestId("text-converted-opportunity-amount")
      ).not.toBeInTheDocument();
    });

    it("hides the amount element for ProductDeveloper role", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(
        screen.queryByTestId("text-converted-opportunity-amount")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("$125,000.00")).not.toBeInTheDocument();
    });

    it("hides the amount element for Resource role", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(screen.queryByText(/\$[\d,]+/)).not.toBeInTheDocument();
    });

    it("still shows the opportunity link for restricted roles", () => {
      mockUseFinancialAccess.mockReturnValue(false);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(screen.getByTestId("link-converted-opportunity")).toBeInTheDocument();
      expect(screen.getByText("FinTest Deal Q4")).toBeInTheDocument();
    });
  });

  describe("authorized roles — amount element must be visible", () => {
    it("shows the formatted dollar amount for Admin role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      const amountEl = screen.getByTestId("text-converted-opportunity-amount");
      expect(amountEl).toBeInTheDocument();
      expect(amountEl).toHaveTextContent("$125,000.00");
    });

    it("shows the formatted dollar amount for SalesManager role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(screen.getByTestId("text-converted-opportunity-amount")).toBeInTheDocument();
      expect(screen.getByText("$125,000.00")).toBeInTheDocument();
    });

    it("shows the formatted dollar amount for SalesRep role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(screen.getByText("$125,000.00")).toBeInTheDocument();
    });

    it("shows the formatted dollar amount for Reviewer role", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(<ConvertedOpportunityAmount opportunity={makeOpportunity()} onNavigate={noop} />);

      expect(screen.getByTestId("text-converted-opportunity-amount")).toBeInTheDocument();
    });
  });

  describe("edge case: opportunity with null amount", () => {
    it("hides the amount element when amount is null even for authorized roles", () => {
      mockUseFinancialAccess.mockReturnValue(true);

      render(
        <ConvertedOpportunityAmount opportunity={makeOpportunity({ amount: null })} onNavigate={noop} />
      );

      expect(
        screen.queryByTestId("text-converted-opportunity-amount")
      ).not.toBeInTheDocument();
    });
  });
});
