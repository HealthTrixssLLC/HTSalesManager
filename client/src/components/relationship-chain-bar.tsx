import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Building2, Users, UserPlus, Target, Calendar } from "lucide-react";
import type { Account, Contact, Lead, Opportunity, Activity } from "@shared/schema";

export type EntityType = "account" | "contact" | "lead" | "opportunity" | "activity";

interface ChainLink {
  label: string;
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

const apiPathMap: Record<EntityType, string> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  activity: "activities",
};

function useChainData(entityType: EntityType, entityId: string) {
  const needsRelatedData = entityType === "contact" || entityType === "opportunity" || entityType === "activity";

  const { data: relatedData } = useQuery<any>({
    queryKey: [`/api/${apiPathMap[entityType]}`, entityId, "related"],
    enabled: !!entityId && needsRelatedData,
  });

  const { data: entityData } = useQuery<any>({
    queryKey: [`/api/${apiPathMap[entityType]}`, entityId],
    enabled: !!entityId,
  });

  const chain: ChainLink[] = [];

  if (entityType === "contact") {
    const account = relatedData?.account?.items?.[0];
    if (account) {
      chain.push({ label: account.name, href: `/accounts/${account.id}`, type: "account" });
    } else if (entityData?.accountId) {
      chain.push({ label: "Account", href: `/accounts/${entityData.accountId}`, type: "account" });
    }
  }

  if (entityType === "opportunity") {
    const account = relatedData?.account?.items?.[0];
    if (account) {
      chain.push({ label: account.name, href: `/accounts/${account.id}`, type: "account" });
    } else if (entityData?.accountId) {
      chain.push({ label: "Account", href: `/accounts/${entityData.accountId}`, type: "account" });
    }
  }

  if (entityType === "activity") {
    if (entityData?.relatedType && entityData?.relatedId) {
      const relType = entityData.relatedType.toLowerCase() as EntityType;
      const routeType = apiPathMap[relType] || entityData.relatedType.toLowerCase() + "s";
      chain.push({
        label: entityData.relatedType,
        href: `/${routeType}/${entityData.relatedId}`,
        type: relType,
      });
    }
  }

  return chain;
}

export function RelationshipChainBar({ entityType, entityId, entityName }: RelationshipChainBarProps) {
  const chain = useChainData(entityType, entityId);

  if (chain.length === 0) return null;

  const CurrentIcon = typeIcons[entityType];

  return (
    <div className="flex items-center gap-1 flex-wrap text-sm" data-testid="relationship-chain-bar">
      {chain.map((link, index) => {
        const Icon = typeIcons[link.type];
        return (
          <span key={index} className="flex items-center gap-1">
            <Link href={link.href}>
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover-elevate cursor-pointer text-muted-foreground hover:text-foreground transition-colors" data-testid={`chain-link-${link.type}`}>
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: typeColors[link.type] }} />
                <span className="truncate max-w-[140px]">{link.label}</span>
              </span>
            </Link>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-medium">
        <CurrentIcon className="h-3.5 w-3.5 shrink-0" style={{ color: typeColors[entityType] }} />
        <span className="truncate max-w-[160px]">{entityName}</span>
      </span>
    </div>
  );
}
