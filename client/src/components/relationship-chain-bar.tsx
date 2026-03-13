import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Building2, Users, UserPlus, Target, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Account, Contact, Lead, Opportunity, Activity } from "@shared/schema";

export type EntityType = "account" | "contact" | "lead" | "opportunity" | "activity";

interface RelatedSection<T> {
  items: T[];
  total: number;
}

interface AccountRelatedData {
  contacts: RelatedSection<Contact>;
  opportunities: RelatedSection<Opportunity>;
  activities: RelatedSection<Activity>;
}

interface ContactRelatedData {
  account: RelatedSection<Account>;
  opportunities: RelatedSection<Opportunity>;
  activities: RelatedSection<Activity>;
}

interface LeadRelatedData {
  activities: RelatedSection<Activity>;
  convertedAccount?: Account | null;
  convertedContact?: Contact | null;
  convertedOpportunity?: Opportunity | null;
}

interface OpportunityRelatedData {
  account: RelatedSection<Account>;
  contacts: RelatedSection<Contact>;
  activities: RelatedSection<Activity>;
}

interface ChainLink {
  label: string;
  href: string;
  type: EntityType;
}

interface CountChip {
  label: string;
  count: number;
  href: string;
  type: EntityType;
}

interface RelationshipChainBarProps {
  entityType: EntityType;
  entityId: string;
  entityName: string;
}

const typeIcons: Record<EntityType, typeof Building2> = {
  account: Building2,
  contact: Users,
  lead: UserPlus,
  opportunity: Target,
  activity: Calendar,
};

const typeColors: Record<EntityType, string> = {
  account: "hsl(216, 40%, 30%)",
  contact: "hsl(195, 57%, 37%)",
  lead: "hsl(39, 99%, 50%)",
  opportunity: "hsl(142, 50%, 36%)",
  activity: "hsl(262, 52%, 47%)",
};

function useAccountChain(entityId: string) {
  const { data } = useQuery<AccountRelatedData>({
    queryKey: ["/api/accounts", entityId, "related"],
    enabled: !!entityId,
  });
  const chain: ChainLink[] = [];
  const counts: CountChip[] = [];
  if (data) {
    if (data.contacts.total > 0) {
      data.contacts.items.slice(0, 3).forEach((c) => {
        chain.push({ label: `${c.firstName} ${c.lastName}`, href: `/contacts/${c.id}`, type: "contact" });
      });
      counts.push({ label: "Contacts", count: data.contacts.total, href: `/accounts/${entityId}`, type: "contact" });
    }
    if (data.opportunities.total > 0) {
      data.opportunities.items.slice(0, 2).forEach((o) => {
        chain.push({ label: o.name, href: `/opportunities/${o.id}`, type: "opportunity" });
      });
      counts.push({ label: "Opportunities", count: data.opportunities.total, href: `/accounts/${entityId}`, type: "opportunity" });
    }
    if (data.activities.total > 0) {
      counts.push({ label: "Activities", count: data.activities.total, href: `/accounts/${entityId}`, type: "activity" });
    }
  }
  return { chain, counts };
}

function useContactChain(entityId: string) {
  const { data } = useQuery<ContactRelatedData>({
    queryKey: ["/api/contacts", entityId, "related"],
    enabled: !!entityId,
  });
  const chain: ChainLink[] = [];
  const counts: CountChip[] = [];
  if (data) {
    const account = data.account.items[0];
    if (account) chain.push({ label: account.name, href: `/accounts/${account.id}`, type: "account" });
    if (data.opportunities.total > 0) {
      data.opportunities.items.slice(0, 2).forEach((o) => {
        chain.push({ label: o.name, href: `/opportunities/${o.id}`, type: "opportunity" });
      });
      counts.push({ label: "Opportunities", count: data.opportunities.total, href: `/contacts/${entityId}`, type: "opportunity" });
    }
    if (data.activities.total > 0) {
      counts.push({ label: "Activities", count: data.activities.total, href: `/contacts/${entityId}`, type: "activity" });
    }
  }
  return { chain, counts };
}

function useLeadChain(entityId: string) {
  const { data } = useQuery<LeadRelatedData>({
    queryKey: ["/api/leads", entityId, "related"],
    enabled: !!entityId,
  });
  const chain: ChainLink[] = [];
  const counts: CountChip[] = [];
  if (data) {
    if (data.convertedAccount) {
      chain.push({ label: data.convertedAccount.name, href: `/accounts/${data.convertedAccount.id}`, type: "account" });
    }
    if (data.convertedContact) {
      chain.push({
        label: `${data.convertedContact.firstName} ${data.convertedContact.lastName}`,
        href: `/contacts/${data.convertedContact.id}`,
        type: "contact",
      });
    }
    if (data.convertedOpportunity) {
      chain.push({ label: data.convertedOpportunity.name, href: `/opportunities/${data.convertedOpportunity.id}`, type: "opportunity" });
    }
    if (data.activities.total > 0) {
      counts.push({ label: "Activities", count: data.activities.total, href: `/leads/${entityId}`, type: "activity" });
    }
  }
  return { chain, counts };
}

function useOpportunityChain(entityId: string) {
  const { data } = useQuery<OpportunityRelatedData>({
    queryKey: ["/api/opportunities", entityId, "related"],
    enabled: !!entityId,
  });
  const chain: ChainLink[] = [];
  const counts: CountChip[] = [];
  if (data) {
    const account = data.account.items[0];
    if (account) chain.push({ label: account.name, href: `/accounts/${account.id}`, type: "account" });
    if (data.contacts.total > 0) {
      data.contacts.items.slice(0, 2).forEach((c) => {
        chain.push({ label: `${c.firstName} ${c.lastName}`, href: `/contacts/${c.id}`, type: "contact" });
      });
      counts.push({ label: "Contacts", count: data.contacts.total, href: `/opportunities/${entityId}`, type: "contact" });
    }
    if (data.activities.total > 0) {
      counts.push({ label: "Activities", count: data.activities.total, href: `/opportunities/${entityId}`, type: "activity" });
    }
  }
  return { chain, counts };
}

function useChainData(entityType: EntityType, entityId: string) {
  const accountData = useAccountChain(entityType === "account" ? entityId : "");
  const contactData = useContactChain(entityType === "contact" ? entityId : "");
  const leadData = useLeadChain(entityType === "lead" ? entityId : "");
  const opportunityData = useOpportunityChain(entityType === "opportunity" ? entityId : "");

  switch (entityType) {
    case "account": return accountData;
    case "contact": return contactData;
    case "lead": return leadData;
    case "opportunity": return opportunityData;
    default: return { chain: [], counts: [] };
  }
}

export function RelationshipChainBar({ entityType, entityId, entityName }: RelationshipChainBarProps) {
  const { chain, counts } = useChainData(entityType, entityId);

  if (chain.length === 0 && counts.length === 0) return null;

  const CurrentIcon = typeIcons[entityType];

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-sm" data-testid="relationship-chain-bar">
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-medium">
        <CurrentIcon className="h-3.5 w-3.5 shrink-0" style={{ color: typeColors[entityType] }} />
        <span className="truncate max-w-[160px]">{entityName}</span>
      </span>
      {chain.length > 0 && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          {chain.map((link, index) => {
            const Icon = typeIcons[link.type];
            return (
              <span key={`${link.type}-${index}`} className="flex items-center gap-1">
                <Link href={link.href}>
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover-elevate cursor-pointer text-muted-foreground hover:text-foreground transition-colors" data-testid={`chain-link-${link.type}-${index}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: typeColors[link.type] }} />
                    <span className="truncate max-w-[140px]">{link.label}</span>
                  </span>
                </Link>
                {index < chain.length - 1 && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                )}
              </span>
            );
          })}
        </>
      )}
      {counts.length > 0 && (
        <>
          <span className="text-muted-foreground/30 mx-1">|</span>
          {counts.map((chip, index) => {
            const ChipIcon = typeIcons[chip.type];
            return (
              <Link key={`count-${chip.type}-${index}`} href={chip.href}>
                <Badge
                  variant="secondary"
                  className="gap-1.5 text-xs font-normal cursor-pointer"
                  data-testid={`chain-count-${chip.type}`}
                >
                  <ChipIcon className="h-3 w-3 shrink-0" style={{ color: typeColors[chip.type] }} />
                  {chip.count} {chip.label}
                </Badge>
              </Link>
            );
          })}
        </>
      )}
    </div>
  );
}
