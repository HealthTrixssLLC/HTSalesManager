import { useQuery } from "@tanstack/react-query";
import { ClipboardList, CheckCircle2, AlertCircle, Calendar, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ActivitiesSummary {
  totalCount: number;
  byStatus: {
    pending: number;
    completed: number;
    cancelled: number;
  };
  byType: {
    call: number;
    email: number;
    meeting: number;
    task: number;
    note: number;
  };
  byPriority: {
    high: number;
    medium: number;
    low: number;
  };
  overdue: number;
  overdueHighPriority: number;
  dueThisWeek: number;
  dueThisWeekByType: {
    meeting: number;
    call: number;
  };
  recentAdditions: {
    last7Days: number;
  };
  byOwner: Record<string, { count: number; ownerName: string }>;
}

export function ActivitiesSummaryCards() {
  const { data: summary, isLoading } = useQuery<ActivitiesSummary>({
    queryKey: ["/api/activities/summary"],
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
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="activities-summary-cards">
      <Card data-testid="card-total-activities">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Activities
          </CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {summary.totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.byStatus.pending} pending, {summary.byStatus.completed} completed
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-overdue">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Overdue
          </CardTitle>
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-overdue-count">
            {summary.overdue}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.overdueHighPriority} high priority
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-due-this-week">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Due This Week
          </CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-due-this-week-count">
            {summary.dueThisWeek}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.dueThisWeekByType.meeting} meetings, {summary.dueThisWeekByType.call} calls
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
            Last 7 days
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
