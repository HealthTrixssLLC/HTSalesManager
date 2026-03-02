import { Home, Building2, Users, UserPlus, Target, Calendar, History, Settings, LogOut, HelpCircle, Upload, BarChart3 } from "lucide-react";
import { Link, useLocation } from "wouter";
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

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const isActive = (url: string) =>
    url === "/" ? location === "/" : location.startsWith(url);

  return (
    <Sidebar
      style={{ background: "linear-gradient(160deg, hsl(186,65%,14%) 0%, hsl(186,55%,19%) 60%, hsl(186,48%,22%) 100%)" }}
      className="border-r-0"
    >
      {/* Logo / Brand */}
      <SidebarHeader className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "hsl(186, 78%, 42%)" }}>
            <span className="text-white font-bold text-sm tracking-tight">HT</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-none">Health Trixss</p>
            <p className="text-white/50 text-xs mt-0.5">CRM Platform</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        {/* Main navigation */}
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
                          ? "bg-white/15 text-white font-medium rounded-md"
                          : "text-white/65 hover:text-white hover:bg-white/10 rounded-md transition-colors duration-150"
                      }
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin section */}
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
                          ? "bg-white/15 text-white font-medium rounded-md"
                          : "text-white/65 hover:text-white hover:bg-white/10 rounded-md transition-colors duration-150"
                      }
                    >
                      <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon className="h-4 w-4 shrink-0" />
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

      {/* User footer */}
      <SidebarFooter className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback
              className="text-xs font-semibold"
              style={{ background: "hsl(186, 60%, 38%)", color: "white" }}
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
          {logoutMutation.isPending ? "Logging out…" : "Log out"}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
