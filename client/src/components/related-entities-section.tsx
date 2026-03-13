import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, ChevronRight, Building2, Users, UserPlus, Target, Calendar } from "lucide-react";
import type { Account, Contact, Opportunity, Lead, Activity } from "@shared/schema";

interface RelatedEntitiesSectionProps {
  title: string;
  entities: Array<Account | Contact | Opportunity | Lead | Activity>;
  entityType: "accounts" | "contacts" | "opportunities" | "leads" | "activities";
  emptyMessage?: string;
  onAdd?: () => void;
}

const typeIcons: Record<string, typeof Building2> = {
  accounts: Building2,
  contacts: Users,
  leads: UserPlus,
  opportunities: Target,
  activities: Calendar,
};

const typeAvatarColors: Record<string, { bg: string; text: string }> = {
  accounts: { bg: "hsl(216, 40%, 92%)", text: "hsl(216, 40%, 30%)" },
  contacts: { bg: "hsl(195, 45%, 90%)", text: "hsl(195, 57%, 37%)" },
  leads: { bg: "hsl(39, 80%, 92%)", text: "hsl(39, 99%, 40%)" },
  opportunities: { bg: "hsl(142, 40%, 90%)", text: "hsl(142, 50%, 30%)" },
  activities: { bg: "hsl(262, 40%, 92%)", text: "hsl(262, 52%, 40%)" },
};

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
          <div className="space-y-1.5">
            {entities.map((entity) => (
              <RelatedEntityCard
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

interface RelatedEntityCardProps {
  entity: Account | Contact | Opportunity | Lead | Activity;
  entityType: "accounts" | "contacts" | "opportunities" | "leads" | "activities";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function RelatedEntityCard({ entity, entityType }: RelatedEntityCardProps) {
  const colors = typeAvatarColors[entityType];
  const Icon = typeIcons[entityType];

  const getEntityInfo = () => {
    if (entityType === "accounts") {
      const account = entity as Account;
      return {
        title: account.name,
        initials: getInitials(account.name),
        subtitle: account.industry || undefined,
        badge: account.type,
        link: `/accounts/${account.id}`,
      };
    } else if (entityType === "contacts") {
      const contact = entity as Contact;
      const name = `${contact.firstName} ${contact.lastName}`;
      return {
        title: name,
        initials: getInitials(name),
        subtitle: contact.email || contact.title || undefined,
        badge: contact.title || undefined,
        link: `/contacts/${contact.id}`,
      };
    } else if (entityType === "opportunities") {
      const opp = entity as Opportunity;
      return {
        title: opp.name,
        initials: getInitials(opp.name),
        subtitle: opp.amount
          ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(opp.amount)
          : undefined,
        badge: opp.stage,
        link: `/opportunities/${opp.id}`,
      };
    } else if (entityType === "leads") {
      const lead = entity as Lead;
      const name = `${lead.firstName} ${lead.lastName}`;
      return {
        title: name,
        initials: getInitials(name),
        subtitle: lead.email || lead.company || undefined,
        badge: lead.status,
        link: `/leads/${lead.id}`,
      };
    } else if (entityType === "activities") {
      const activity = entity as Activity;
      return {
        title: activity.subject,
        initials: activity.type ? activity.type[0].toUpperCase() : "A",
        subtitle: activity.dueAt ? `Due: ${new Date(activity.dueAt).toLocaleDateString()}` : activity.type,
        badge: activity.status,
        link: `/activities/${activity.id}`,
      };
    }
    return { title: "", initials: "?", link: "" };
  };

  const { title, initials, subtitle, badge, link } = getEntityInfo();

  return (
    <Link href={link}>
      <div
        className="flex items-center gap-3 p-2.5 rounded-md hover-elevate active-elevate-2 cursor-pointer group"
        data-testid={`related-${entityType}-${entity.id}`}
      >
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback
            className="text-[10px] font-semibold"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-1 shrink-0">
          {badge && (
            <Badge variant="secondary" className="text-[10px]">
              {badge}
            </Badge>
          )}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        </div>
      </div>
    </Link>
  );
}
