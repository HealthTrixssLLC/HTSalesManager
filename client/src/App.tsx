// Main application with routing and auth provider
// Based on javascript_auth_all_persistance blueprint

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "@/lib/protected-route";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

// Pages
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

function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <>{children}</>;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-14 px-4 border-b bg-background">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex-1" />
          </header>
          <main className="flex-1 overflow-y-auto p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      
      <ProtectedRoute path="/" component={Dashboard} />
      <ProtectedRoute path="/accounts/:id" component={AccountDetailPage} />
      <ProtectedRoute path="/accounts" component={AccountsPage} />
      <ProtectedRoute path="/contacts/:id" component={ContactDetailPage} />
      <ProtectedRoute path="/contacts" component={ContactsPage} />
      <ProtectedRoute path="/leads/:id" component={LeadDetailPage} />
      <ProtectedRoute path="/leads" component={LeadsPage} />
      <ProtectedRoute path="/opportunities/:id" component={OpportunityDetailPage} />
      <ProtectedRoute path="/opportunities" component={OpportunitiesPage} />
      <ProtectedRoute path="/activities/:id" component={ActivityDetailPage} />
      <ProtectedRoute path="/activities" component={ActivitiesPage} />
      <ProtectedRoute path="/analytics" component={AnalyticsPage} />
      <ProtectedRoute path="/import" component={ImportPage} />
      <ProtectedRoute path="/help" component={HelpPage} />
      <ProtectedRoute path="/admin" component={AdminConsole} />
      <ProtectedRoute path="/audit-log" component={AuditLogPage} />
      
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
