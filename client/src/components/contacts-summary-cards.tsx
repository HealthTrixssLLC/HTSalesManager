import { useQuery } from "@tanstack/react-query";
import { Users, Building2, TrendingUp, Mail, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ContactsSummary {
  totalCount: number;
  accountDistribution: {
    withAccount: number;
    withoutAccount: number;
  };
  topAccounts: Array<{
    accountId: string;
    accountName: string;
    count: number;
  }>;
  recentAdditions: {
    last7Days: number;
    last30Days: number;
  };
  emailDistribution: {
    withEmail: number;
    withoutEmail: number;
  };
}

export function ContactsSummaryCards() {
  const { data: summary, isLoading } = useQuery<ContactsSummary>({
    queryKey: ["/api/contacts/summary"],
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
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

  const topAccount = summary.topAccounts[0];

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" data-testid="contacts-summary-cards">
      <Card data-testid="card-total-contacts">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Contacts
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {summary.totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.accountDistribution.withAccount} with accounts
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-with-accounts">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            With Accounts
          </CardTitle>
          <UserCheck className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-with-accounts">
            {summary.accountDistribution.withAccount}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.accountDistribution.withoutAccount} without accounts
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

      <Card data-testid="card-top-account">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Top Account
          </CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-top-account-count">
            {topAccount ? topAccount.count : 0}
          </div>
          <p className="text-xs text-muted-foreground">
            {topAccount ? topAccount.accountName : "No accounts"}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-with-email">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Contacts with Email
          </CardTitle>
          <Mail className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-with-email">
            {summary.emailDistribution.withEmail}
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.emailDistribution.withoutEmail} without email
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
