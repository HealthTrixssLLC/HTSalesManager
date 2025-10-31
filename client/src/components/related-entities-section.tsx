import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ExternalLink } from "lucide-react";
import type { Account, Contact, Opportunity, Lead, Activity } from "@shared/schema";

interface RelatedEntitiesSectionProps {
  title: string;
  entities: Array<Account | Contact | Opportunity | Lead | Activity>;
  entityType: "accounts" | "contacts" | "opportunities" | "leads" | "activities";
  emptyMessage?: string;
  onAdd?: () => void;
}

export function RelatedEntitiesSection({
  title,
  entities,
  entityType,
  emptyMessage = "No items found",
  onAdd,
}: RelatedEntitiesSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">
          {title} ({entities.length})
        </CardTitle>
        {onAdd && (
          <Button size="sm" variant="outline" onClick={onAdd} data-testid={`button-add-${entityType}`}>
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {entities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">{emptyMessage}</p>
        ) : (
          <div className="space-y-2">
            {entities.map((entity) => (
              <RelatedEntityItem
                key={entity.id}
                entity={entity}
                entityType={entityType}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RelatedEntityItemProps {
  entity: Account | Contact | Opportunity | Lead | Activity;
  entityType: "accounts" | "contacts" | "opportunities" | "leads" | "activities";
}

function RelatedEntityItem({ entity, entityType }: RelatedEntityItemProps) {
  const getEntityInfo = () => {
    if (entityType === "accounts") {
      const account = entity as Account;
      return {
        title: account.name,
        subtitle: account.industry || undefined,
        badge: account.type,
        link: `/accounts/${account.id}`,
      };
    } else if (entityType === "contacts") {
      const contact = entity as Contact;
      return {
        title: `${contact.firstName} ${contact.lastName}`,
        subtitle: contact.email || contact.phone || undefined,
        badge: contact.title || undefined,
        link: `/contacts/${contact.id}`,
      };
    } else if (entityType === "opportunities") {
      const opp = entity as Opportunity;
      return {
        title: opp.name,
        subtitle: opp.amount
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(opp.amount)
          : undefined,
        badge: opp.stage,
        link: `/opportunities/${opp.id}`,
      };
    } else if (entityType === "leads") {
      const lead = entity as Lead;
      return {
        title: `${lead.firstName} ${lead.lastName}`,
        subtitle: lead.email || lead.phone || undefined,
        badge: lead.status,
        link: `/leads/${lead.id}`,
      };
    } else if (entityType === "activities") {
      const activity = entity as Activity;
      return {
        title: activity.subject,
        subtitle: activity.type,
        badge: activity.status,
        link: `/activities/${activity.id}`,
      };
    }
    return { title: "", link: "" };
  };

  const { title, subtitle, badge, link } = getEntityInfo();

  return (
    <Link href={link}>
      <div
        className="flex items-center justify-between p-3 rounded-md border hover-elevate active-elevate-2 cursor-pointer"
        data-testid={`related-${entityType}-${entity.id}`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3">
          {badge && (
            <Badge variant="secondary" className="shrink-0">
              {badge}
            </Badge>
          )}
          <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
        </div>
      </div>
    </Link>
  );
}
