import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import AccountsPage from "@/pages/accounts-page";
import AccountDetailPage from "@/pages/account-detail-page";
import ContactsPage from "@/pages/contacts-page";
import ContactDetailPage from "@/pages/contact-detail-page";
import LeadsPage from "@/pages/leads-page";
import LeadDetailPage from "@/pages/lead-detail-page";
import OpportunitiesPage from "@/pages/opportunities-page";
import OpportunityDetailPage from "@/pages/opportunity-detail-page";
import ActivitiesPage from "@/pages/activities-page";
import ActivityDetailPage from "@/pages/activity-detail-page";
import ImportPage from "@/pages/import-page";
import AdminConsole from "@/pages/admin-console";
import AuditLogPage from "@/pages/audit-log-page";
import HelpPage from "@/pages/help-page";
import AnalyticsPage from "@/pages/analytics-page";
import ResourceAllocationPage from "@/pages/resource-allocation-page";
import { Redirect } from "wouter";

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <>{children}</>;
  }

  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* VR-002: Minimal top bar — just the sidebar trigger */}
          <header className="flex items-center h-12 px-4 border-b bg-background shrink-0">
            <SidebarTrigger
              data-testid="button-sidebar-toggle"
              className="text-muted-foreground hover:text-foreground"
            />
          </header>
          <main className="flex-1 overflow-y-auto bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function CrmGuardedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </Route>
    );
  }

  if (!user) {
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  const isLimitedRole = user.roles?.some(r => r.name === "ProductDeveloper" || r.name === "Resource") && !user.roles?.some(r => ["Admin", "SalesManager", "SalesRep", "ReadOnly"].includes(r.name));

  if (isLimitedRole) {
    return (
      <Route path={path}>
        <Redirect to="/resource-allocation" />
      </Route>
    );
  }

  return <Route path={path} component={Component} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />

      <CrmGuardedRoute path="/" component={Dashboard} />
      <CrmGuardedRoute path="/accounts/:id" component={AccountDetailPage} />
      <CrmGuardedRoute path="/accounts" component={AccountsPage} />
      <CrmGuardedRoute path="/contacts/:id" component={ContactDetailPage} />
      <CrmGuardedRoute path="/contacts" component={ContactsPage} />
      <CrmGuardedRoute path="/leads/:id" component={LeadDetailPage} />
      <CrmGuardedRoute path="/leads" component={LeadsPage} />
      <CrmGuardedRoute path="/opportunities/:id" component={OpportunityDetailPage} />
      <CrmGuardedRoute path="/opportunities" component={OpportunitiesPage} />
      <CrmGuardedRoute path="/activities/:id" component={ActivityDetailPage} />
      <CrmGuardedRoute path="/activities" component={ActivitiesPage} />
      <CrmGuardedRoute path="/analytics" component={AnalyticsPage} />
      <CrmGuardedRoute path="/import" component={ImportPage} />
      <CrmGuardedRoute path="/help" component={HelpPage} />
      <CrmGuardedRoute path="/admin" component={AdminConsole} />
      <CrmGuardedRoute path="/audit-log" component={AuditLogPage} />
      <ProtectedRoute path="/resource-allocation" component={ResourceAllocationPage} />

      <Route>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-4xl font-semibold mb-2">404</h1>
            <p className="text-muted-foreground">Page not found</p>
          </div>
        </div>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppLayout>
            <Router />
          </AppLayout>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
