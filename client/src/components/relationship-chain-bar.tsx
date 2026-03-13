import { Link } from "wouter";
import { ChevronRight, Building2, Users, UserPlus, Target, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ChainLink {
  label: string;
  href: string;
  type: "account" | "contact" | "lead" | "opportunity" | "activity";
  id?: string;
}

interface RelationshipChainBarProps {
  chain: ChainLink[];
  current: {
    label: string;
    type: ChainLink["type"];
  };
}

const typeIcons: Record<ChainLink["type"], typeof Building2> = {
  account: Building2,
  contact: Users,
  lead: UserPlus,
  opportunity: Target,
  activity: Calendar,
};

const typeColors: Record<ChainLink["type"], string> = {
  account: "hsl(216, 40%, 30%)",
  contact: "hsl(195, 57%, 37%)",
  lead: "hsl(39, 99%, 50%)",
  opportunity: "hsl(142, 50%, 36%)",
  activity: "hsl(262, 52%, 47%)",
};

export function RelationshipChainBar({ chain, current }: RelationshipChainBarProps) {
  if (chain.length === 0) return null;

  const CurrentIcon = typeIcons[current.type];

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
        <CurrentIcon className="h-3.5 w-3.5 shrink-0" style={{ color: typeColors[current.type] }} />
        <span className="truncate max-w-[160px]">{current.label}</span>
      </span>
    </div>
  );
}
