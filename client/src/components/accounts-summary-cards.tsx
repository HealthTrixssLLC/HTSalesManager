import { useQuery } from "@tanstack/react-query";
import { Building2, Users, TrendingUp, Calendar, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AccountsSummary {
  totalCount: number;
  byType: {
    customer: number;
    partner: number;
    prospect: number;
    vendor: number;
    other: number;
  };
  byCategory: Record<string, number>;
  byOwner: Record<string, { count: number; ownerName: string }>;
  recentAdditions: {
    last7Days: number;
    last30Days: number;
  };
}

export function AccountsSummaryCards() {
  const { data: summary, isLoading } = useQuery<AccountsSummary>({
    queryKey: ["/api/accounts/summary"],
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const topCategory = Object.entries(summary.byCategory || {})
    .sort(([, a], [, b]) => b - a)[0];

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-summary-cards">
      <Card data-testid="card-total-accounts">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Accounts
          </CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {summary.totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.byType.customer} customers, {summary.byType.prospect} prospects
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-customers">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Customers
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-customer-count">
            {summary.byType.customer}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.byType.partner} partners, {summary.byType.vendor} vendors
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-recent">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Additions
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-recent-7days">
            {summary.recentAdditions.last7Days}
          </div>
          <p className="text-xs text-muted-foreground">
            Last 7 days ({summary.recentAdditions.last30Days} in 30 days)
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-top-category">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Top Category
          </CardTitle>
          <Briefcase className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-top-category-count">
            {topCategory ? topCategory[1] : 0}
          </div>
          <p className="text-xs text-muted-foreground">
            {topCategory ? topCategory[0] : "No categories"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
