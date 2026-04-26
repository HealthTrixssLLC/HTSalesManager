import { Building2, Check, ChevronDown, Star } from "lucide-react";
import { useOrg } from "@/contexts/org-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function OrgSwitcher() {
  const { activeOrg, activeOrgId, userOrgs, switchOrg, setDefaultOrg, isLoading } = useOrg();

  if (isLoading || userOrgs.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
        <Building2 className="h-4 w-4 text-white/50 shrink-0" />
        <span className="text-xs text-white/50 truncate">Loading...</span>
      </div>
    );
  }

  if (userOrgs.length === 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
        <Building2 className="h-4 w-4 text-white/60 shrink-0" />
        <span className="text-xs text-white/80 truncate font-medium">{activeOrg?.name || "Organization"}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between text-white/80 hover:text-white hover:bg-white/10 px-2 py-1.5 h-auto gap-2"
          data-testid="button-org-switcher"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-white/60 shrink-0" />
            <span className="text-xs font-medium truncate">{activeOrg?.name || "Select Organization"}</span>
          </div>
          <ChevronDown className="h-3 w-3 text-white/40 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" sideOffset={4}>
        {userOrgs.map((entry) => (
          <DropdownMenuItem
            key={entry.organizationId}
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => switchOrg(entry.organizationId)}
            data-testid={`option-org-${entry.organizationId}`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{entry.organization.name}</div>
              <div className="text-xs text-muted-foreground truncate">{entry.roleName}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {entry.isDefault && <Star className="h-3 w-3 text-amber-500" />}
              {entry.organizationId === activeOrgId && <Check className="h-3 w-3 text-primary" />}
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {activeOrgId && (
          <DropdownMenuItem
            className="flex items-center gap-2 cursor-pointer text-muted-foreground"
            onClick={() => setDefaultOrg(activeOrgId)}
            data-testid="button-set-default-org"
          >
            <Star className="h-3 w-3" />
            <span className="text-xs">Set as default org</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
