import { useState, useMemo } from "react";
import { Home, Building2, Users, UserPlus, Target, Calendar, History, Settings, LogOut, HelpCircle, Upload, BarChart3, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlobalQuickAdd, type QuickAddContext } from "@/components/global-quick-add";
import type { Account, Contact } from "@shared/schema";

const menuItems = [
  { title: "Dashboard",     url: "/",             icon: Home },
  { title: "Analytics",     url: "/analytics",    icon: BarChart3 },
  { title: "Accounts",      url: "/accounts",     icon: Building2 },
  { title: "Contacts",      url: "/contacts",     icon: Users },
  { title: "Leads",         url: "/leads",        icon: UserPlus },
  { title: "Opportunities", url: "/opportunities",icon: Target },
  { title: "Activities",    url: "/activities",   icon: Calendar },
];

const adminItems = [
  { title: "CSV Import",       url: "/import",    icon: Upload },
  { title: "Admin Console",    url: "/admin",     icon: Settings },
  { title: "Audit Log",        url: "/audit-log", icon: History },
  { title: "Help & Migration", url: "/help",      icon: HelpCircle },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const routeMatch = useMemo(() => {
    const patterns = [
      { pattern: /^\/accounts\/([^/]+)$/, type: "account" as const },
      { pattern: /^\/contacts\/([^/]+)$/, type: "contact" as const },
      { pattern: /^\/leads\/([^/]+)$/, type: "lead" as const },
      { pattern: /^\/opportunities\/([^/]+)$/, type: "opportunity" as const },
    ];
    for (const { pattern, type } of patterns) {
      const match = location.match(pattern);
      if (match && match[1]) return { type, id: match[1] };
    }
    return null;
  }, [location]);

  const { data: contextAccount } = useQuery<Account>({
    queryKey: ["/api/accounts", routeMatch?.id],
    enabled: routeMatch?.type === "account" && !!routeMatch.id,
  });

  const { data: contextContact } = useQuery<Contact>({
    queryKey: ["/api/contacts", routeMatch?.id],
    enabled: routeMatch?.type === "contact" && !!routeMatch.id,
  });

  const routeContext = useMemo((): QuickAddContext | undefined => {
    if (!routeMatch) return undefined;
    const primaryEntityType = routeMatch.type.charAt(0).toUpperCase() + routeMatch.type.slice(1) as QuickAddContext["primaryEntityType"];
    switch (routeMatch.type) {
      case "account":
        return { accountId: routeMatch.id, accountName: contextAccount?.name, primaryEntityType, primaryEntityId: routeMatch.id };
      case "contact":
        return {
          contactId: routeMatch.id,
          contactName: contextContact ? `${contextContact.firstName} ${contextContact.lastName}` : undefined,
          accountId: contextContact?.accountId || undefined,
          primaryEntityType, primaryEntityId: routeMatch.id,
        };
      case "lead":
        return { leadId: routeMatch.id, primaryEntityType, primaryEntityId: routeMatch.id };
      case "opportunity":
        return { opportunityId: routeMatch.id, primaryEntityType, primaryEntityId: routeMatch.id };
      default:
        return undefined;
    }
  }, [routeMatch, contextAccount, contextContact]);

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const isActive = (url: string) =>
    url === "/" ? location === "/" : location.startsWith(url);

  return (
    <>
      <Sidebar className="border-r-0" style={{ background: "linear-gradient(160deg, hsl(216,42%,18%) 0%, hsl(216,40%,22%) 60%, hsl(216,38%,26%) 100%)" }}>
        <SidebarHeader className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <img
              src="/ht-logo.png"
              alt="HealthTrixss"
              className="h-9 w-9 rounded-md shrink-0 object-contain bg-white"
            />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-none">HealthTrixss</p>
              <p className="text-white/50 text-xs mt-0.5">CRM Platform</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-3 py-4">
          <SidebarGroup>
            <SidebarGroupLabel className="text-white/40 text-[10px] font-semibold uppercase tracking-widest px-2 mb-1">
              Navigation
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {menuItems.map(item => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className={
                          active
                            ? "text-white font-medium rounded-md"
                            : "text-white/65 hover:text-white hover:bg-white/10 rounded-md transition-colors duration-150"
                        }
                        style={active ? { backgroundColor: "rgba(254,160,2,0.22)" } : undefined}
                      >
                        <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                          <item.icon className="h-4 w-4 shrink-0" style={active ? { color: "hsl(39,99%,60%)" } : undefined} />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="text-white/40 text-[10px] font-semibold uppercase tracking-widest px-2 mb-1">
              Administration
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {adminItems.map(item => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className={
                          active
                            ? "text-white font-medium rounded-md"
                            : "text-white/65 hover:text-white hover:bg-white/10 rounded-md transition-colors duration-150"
                        }
                        style={active ? { backgroundColor: "rgba(254,160,2,0.22)" } : undefined}
                      >
                        <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                          <item.icon className="h-4 w-4 shrink-0" style={active ? { color: "hsl(39,99%,60%)" } : undefined} />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="px-4 py-4 border-t border-white/10">
          <Button
            variant="ghost"
            className="w-full justify-start text-white/70 hover:text-white hover:bg-white/10 gap-2 mb-3"
            onClick={() => setQuickAddOpen(true)}
            data-testid="button-global-quick-add"
          >
            <Plus className="h-4 w-4" />
            Quick Add
          </Button>
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback
                className="text-xs font-semibold"
                style={{ background: "hsl(216, 45%, 40%)", color: "white" }}
              >
                {user ? getInitials(user.name) : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate leading-none">{user?.name}</p>
              <p className="text-xs text-white/45 truncate mt-0.5">{user?.email}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-white/60 hover:text-white hover:bg-white/10 gap-2"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            {logoutMutation.isPending ? "Logging out..." : "Log out"}
          </Button>
        </SidebarFooter>
      </Sidebar>

      <GlobalQuickAdd open={quickAddOpen} onOpenChange={setQuickAddOpen} context={routeContext} />
    </>
  );
}
