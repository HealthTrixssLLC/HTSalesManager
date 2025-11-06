import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, TrendingUp, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Contact {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

interface ContactsSummaryCardsProps {
  onCardClick?: (filterType: string, filterValue: string) => void;
}

export function ContactsSummaryCards({ onCardClick }: ContactsSummaryCardsProps) {
  const { data: contacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
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

  if (!contacts) return null;

  // Calculate statistics
  const totalCount = contacts.length;

  // New contacts (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const newContacts = contacts.filter(
    (c) => new Date(c.createdAt) >= thirtyDaysAgo
  ).length;

  // Recent activity (contacts with email or phone)
  const recentActivity = contacts.filter((c) => c.email || c.phone).length;

  // By source - count contacts with/without accounts
  const withAccount = contacts.filter((c) => c.accountId !== null).length;
  const withoutAccount = contacts.filter((c) => c.accountId === null).length;
  const topSource = withAccount >= withoutAccount ? "From Accounts" : "Direct";
  const topSourceCount = Math.max(withAccount, withoutAccount);

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" data-testid="contacts-summary-cards">
      <Card 
        data-testid="card-total-contacts"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("", "")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Contacts
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-total-count">
            {totalCount}
          </div>
          <p className="text-xs text-muted-foreground">
            All contacts in system
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-new-contacts"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("new", "30days")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            New Contacts
          </CardTitle>
          <UserPlus className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-new-count">
            {newContacts}
          </div>
          <p className="text-xs text-muted-foreground">
            Last 30 days
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-top-source"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("source", topSource === "From Accounts" ? "account" : "direct")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            By Source
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-top-source">
            {topSourceCount}
          </div>
          <p className="text-xs text-muted-foreground">
            {topSource}
          </p>
        </CardContent>
      </Card>

      <Card 
        data-testid="card-recent-activity"
        className={onCardClick ? "cursor-pointer hover-elevate active-elevate-2" : ""}
        onClick={() => onCardClick?.("hasEmail", "true")}
      >
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent Activity
          </CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold" data-testid="text-recent-activity">
            {recentActivity}
          </div>
          <p className="text-xs text-muted-foreground">
            With contact info
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
