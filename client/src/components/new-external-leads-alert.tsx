// Notification for new inbound leads created via the external API
// (website form / email intake). Shows a banner on the Leads page and a
// card on the Dashboard. "Seen" state is stored per user+org in localStorage.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Globe, Mail, Inbox, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useOrg } from "@/contexts/org-context";
import { queryClient } from "@/lib/queryClient";

export type ExternalLead = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  source: string | null;
  rating: string | null;
  status: string;
  sourceSystem: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 60_000;

function seenStorageKey(userId: string | undefined, orgId: string | null) {
  return `externalLeadsSeen:${userId || "anon"}:${orgId || "default"}`;
}

function getLastSeen(key: string): number {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function useNewExternalLeads() {
  const { user } = useAuth();
  const { activeOrgId } = useOrg();
  const storageKey = seenStorageKey(user?.id, activeOrgId);

  const { data: leads = [], isLoading, dataUpdatedAt } = useQuery<ExternalLead[]>({
    queryKey: ["/api/leads/new-external"],
    refetchInterval: POLL_INTERVAL_MS,
    enabled: !!user,
  });

  const lastSeen = getLastSeen(storageKey);
  const newLeads = useMemo(
    () => leads.filter(l => new Date(l.createdAt).getTime() > lastSeen),
    // dataUpdatedAt makes this recompute after refetches and markSeen invalidation
    [leads, lastSeen, dataUpdatedAt]
  );

  const markSeen = () => {
    try {
      localStorage.setItem(storageKey, Date.now().toString());
    } catch {
      // localStorage unavailable — dismissal just won't persist
    }
    queryClient.invalidateQueries({ queryKey: ["/api/leads/new-external"] });
  };

  return { newLeads, recentLeads: leads, isLoading, markSeen };
}

export function sourceInfo(lead: ExternalLead): { label: string; Icon: typeof Globe } {
  if (lead.source === "website") return { label: "Website", Icon: Globe };
  if (lead.source === "email") return { label: "Email", Icon: Mail };
  return { label: lead.source ? lead.source.charAt(0).toUpperCase() + lead.source.slice(1) : "External", Icon: Inbox };
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Banner shown at the top of the Leads page when unseen external leads exist. */
export function NewExternalLeadsBanner() {
  const { newLeads, markSeen } = useNewExternalLeads();

  if (newLeads.length === 0) return null;

  const websiteCount = newLeads.filter(l => l.source === "website").length;
  const emailCount = newLeads.filter(l => l.source === "email").length;
  const otherCount = newLeads.length - websiteCount - emailCount;

  const parts: string[] = [];
  if (websiteCount) parts.push(`${websiteCount} from website`);
  if (emailCount) parts.push(`${emailCount} from email`);
  if (otherCount) parts.push(`${otherCount} other`);

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"
      data-testid="banner-new-external-leads"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <Inbox className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" data-testid="text-new-external-leads-count">
          {newLeads.length} new inbound {newLeads.length === 1 ? "lead" : "leads"} arrived
        </p>
        <p className="text-sm text-muted-foreground" data-testid="text-new-external-leads-sources">
          {parts.join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {newLeads.slice(0, 3).map(lead => {
          const { label, Icon } = sourceInfo(lead);
          return (
            <Badge key={lead.id} variant="secondary" className="gap-1" data-testid={`badge-new-external-lead-${lead.id}`}>
              <Icon className="h-3 w-3" />
              {lead.firstName} {lead.lastName} ({label})
            </Badge>
          );
        })}
        {newLeads.length > 3 && (
          <Badge variant="secondary" data-testid="badge-new-external-leads-more">
            +{newLeads.length - 3} more
          </Badge>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={markSeen}
        aria-label="Dismiss new lead notification"
        data-testid="button-dismiss-new-external-leads"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Dashboard card listing recent inbound (external API) leads. */
export function NewExternalLeadsCard() {
  const { newLeads, recentLeads, isLoading } = useNewExternalLeads();
  const [, setLocation] = useLocation();

  if (isLoading || recentLeads.length === 0) return null;

  return (
    <Card data-testid="card-new-external-leads">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">
          Inbound Leads (last 7 days)
        </CardTitle>
        {newLeads.length > 0 && (
          <Badge data-testid="badge-dashboard-new-external-count">
            {newLeads.length} new
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {recentLeads.slice(0, 5).map(lead => {
          const { label, Icon } = sourceInfo(lead);
          const isNew = newLeads.some(n => n.id === lead.id);
          return (
            <div
              key={lead.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              data-testid={`row-external-lead-${lead.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {lead.firstName} {lead.lastName}
                  {lead.company ? ` — ${lead.company}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {timeAgo(lead.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isNew && (
                  <Badge className="text-xs" data-testid={`badge-external-lead-new-${lead.id}`}>
                    New
                  </Badge>
                )}
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Icon className="h-3 w-3" />
                  {label}
                </Badge>
              </div>
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => setLocation("/leads")}
          data-testid="button-view-all-inbound-leads"
        >
          View all leads
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
