import { useQuery } from "@tanstack/react-query";
import { Users, CheckCircle, TrendingUp, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface LeadsSummary {
  totalCount: number;
  byStatus: {
    new: number;
    contacted: number;
    qualified: number;
    unqualified: number;
    converted: number;
  };
  bySource: Record<string, number>;
  conversionRate: string;
  recentAdditions: {
    last7Days: number;
    last30Days: number;
  };
  byRating: {
    hot: number;
    warm: number;
    cold: number;
  };
}

interface LeadsSummaryCardsProps {
  onCardClick?: (filter: { status?: string; rating?: string }) => void;
}

export function LeadsSummaryCards({ onCardClick }: LeadsSummaryCardsProps) {
  const { data: summary, isLoading } = useQuery<LeadsSummary>({
    queryKey: ["/api/leads/summary"],
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

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="leads-summary-cards">
      <Card 
        data-testid="card-total-leads"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.({})}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Leads
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {summary.totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.byStatus.new} new, {summary.byStatus.contacted} contacted
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-new-leads"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.({ status: "new" })}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            New Leads
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-new-count">
            {summary.byStatus.new}
          </div>
          <p className="text-xs text-muted-foreground">
            Awaiting contact
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-qualified-leads"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.({ status: "qualified" })}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Qualified Leads
          </CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-qualified-count">
            {summary.byStatus.qualified}
          </div>
          <p className="text-xs text-muted-foreground">
            Ready for conversion
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-hot-leads"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.({ rating: "hot" })}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Hot Leads
          </CardTitle>
          <Zap className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-hot-leads">
            {summary.byRating.hot}
          </div>
          <p className="text-xs text-muted-foreground">
            High priority prospects
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
