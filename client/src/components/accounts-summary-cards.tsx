import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, TrendingUp, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Account {
  id: string;
  name: string;
  type: string | null;
  category: string | null;
  createdAt: string;
}

interface Opportunity {
  id: string;
  accountId: string;
  amount: string | null;
}

interface AccountsSummaryCardsProps {
  onCardClick?: (filterType: string, filterValue: string) => void;
}

export function AccountsSummaryCards({ onCardClick }: AccountsSummaryCardsProps) {
  const { data: accounts, isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const { data: opportunities, isLoading: opportunitiesLoading } = useQuery<Opportunity[]>({
    queryKey: ["/api/opportunities"],
  });

  const isLoading = accountsLoading || opportunitiesLoading;

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

  if (!accounts) return null;

  // Calculate statistics
  const totalCount = accounts.length;

  // Active accounts (customers and prospects)
  const activeAccounts = accounts.filter(
    (a) => a.type === "customer" || a.type === "prospect"
  ).length;

  // By category - find top category
  const categoryCounts: Record<string, number> = {};
  accounts.forEach((a) => {
    if (a.category) {
      categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
    }
  });
  const topCategoryEntry = Object.entries(categoryCounts).sort(([, a], [, b]) => b - a)[0];
  const topCategory = topCategoryEntry ? topCategoryEntry[0] : "None";
  const topCategoryCount = topCategoryEntry ? topCategoryEntry[1] : 0;

  // High value - accounts with most opportunities
  const opportunityCountByAccount: Record<string, number> = {};
  opportunities?.forEach((opp) => {
    if (opp.accountId) {
      opportunityCountByAccount[opp.accountId] = (opportunityCountByAccount[opp.accountId] || 0) + 1;
    }
  });
  const highValueEntry = Object.entries(opportunityCountByAccount).sort(([, a], [, b]) => b - a)[0];
  const highValueCount = highValueEntry ? highValueEntry[1] : 0;

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="accounts-summary-cards">
      <Card 
        data-testid="card-total-accounts"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("", "")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Accounts
          </CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            All accounts in system
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-active-accounts"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("type", "active")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Active Accounts
          </CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-active-count">
            {activeAccounts}
          </div>
          <p className="text-xs text-muted-foreground">
            Customers & prospects
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-top-category"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("category", topCategory)}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            By Category
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-top-category">
            {topCategoryCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {topCategory}
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-high-value"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("highValue", "true")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            High Value
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-high-value">
            {highValueCount}
          </div>
          <p className="text-xs text-muted-foreground">
            Most opportunities
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
