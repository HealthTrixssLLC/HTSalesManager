import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp,
  HeartPulse,
  CalendarClock,
  ClipboardList,
  Users2,
  Truck,
  ShieldCheck,
  BarChart2,
  Boxes,
  FileText,
  ArrowUpRight,
  FlaskConical,
} from "lucide-react";

interface AppEntry {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: "live" | "beta" | "coming-soon";
  href?: string;
  category: string;
}

const apps: AppEntry[] = [
  {
    id: "ht-sales-manager",
    name: "HT Sales Manager",
    description: "Full-featured CRM for healthcare sales teams. Manage accounts, contacts, leads, and opportunities in one place.",
    icon: TrendingUp,
    status: "live",
    href: "/",
    category: "Sales & CRM",
  },
  {
    id: "ht-patient-engagement",
    name: "HT Patient Engagement",
    description: "Omnichannel patient communication portal with automated follow-ups, surveys, and appointment reminders.",
    icon: HeartPulse,
    status: "beta",
    category: "Patient Services",
  },
  {
    id: "ht-scheduler",
    name: "HT Scheduling Hub",
    description: "Intelligent appointment scheduling with calendar sync, room booking, and provider availability management.",
    icon: CalendarClock,
    status: "coming-soon",
    category: "Operations",
  },
  {
    id: "ht-billing-pro",
    name: "HT Billing Pro",
    description: "End-to-end medical billing, claims processing, and revenue cycle management with payer integrations.",
    icon: ClipboardList,
    status: "coming-soon",
    category: "Finance",
  },
  {
    id: "ht-hr-hub",
    name: "HT HR Hub",
    description: "Human resources management including onboarding, credentialing, performance reviews, and compliance tracking.",
    icon: Users2,
    status: "coming-soon",
    category: "Human Resources",
  },
  {
    id: "ht-field-service",
    name: "HT Field Service",
    description: "Dispatch and route optimization for field-based healthcare representatives and medical equipment delivery.",
    icon: Truck,
    status: "coming-soon",
    category: "Field Operations",
  },
  {
    id: "ht-compliance",
    name: "HT Compliance Tracker",
    description: "HIPAA, SOC 2, and regulatory compliance monitoring with audit trails, policy management, and risk scoring.",
    icon: ShieldCheck,
    status: "coming-soon",
    category: "Compliance",
  },
  {
    id: "ht-analytics-pro",
    name: "HT Analytics Pro",
    description: "Advanced business intelligence with AI-driven forecasting, custom dashboards, and real-time performance metrics.",
    icon: BarChart2,
    status: "beta",
    category: "Analytics",
  },
  {
    id: "ht-inventory",
    name: "HT Inventory Manager",
    description: "Medical supply and equipment inventory tracking with reorder alerts, vendor management, and expiry monitoring.",
    icon: Boxes,
    status: "coming-soon",
    category: "Supply Chain",
  },
  {
    id: "ht-docs",
    name: "HT Document Center",
    description: "Centralized document management for contracts, proposals, consent forms, and clinical documentation.",
    icon: FileText,
    status: "coming-soon",
    category: "Administration",
  },
];

const statusConfig = {
  live: {
    label: "Live",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  beta: {
    label: "Beta",
    badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    dot: "bg-orange-400",
  },
  "coming-soon": {
    label: "Coming Soon",
    badgeClass: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

function AppCard({ app }: { app: AppEntry }) {
  const Icon = app.icon;
  const status = statusConfig[app.status];
  const isLive = app.status === "live";
  const isBeta = app.status === "beta";
  const isInteractive = isLive || isBeta;

  return (
    <Card
      className={`relative flex flex-col transition-shadow duration-200 ${isInteractive ? "hover-elevate cursor-pointer" : "opacity-80"}`}
      data-testid={`card-app-${app.id}`}
    >
      <CardContent className="flex flex-col gap-4 p-6 flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div
            className="h-12 w-12 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: isLive ? "hsl(216,40%,30%)" : isBeta ? "hsl(39,99%,50%)" : "hsl(216,20%,88%)" }}
          >
            <Icon
              className="h-6 w-6"
              style={{ color: isLive ? "white" : isBeta ? "white" : "hsl(216,20%,55%)" }}
            />
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.badgeClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>

        {/* Text */}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-1">
            <h3 className="font-semibold text-foreground leading-tight" data-testid={`text-app-name-${app.id}`}>
              {app.name}
            </h3>
            {isLive && <FlaskConical className="h-3.5 w-3.5 text-muted-foreground/50 hidden" />}
          </div>
          <p className="text-xs text-muted-foreground/70 leading-tight">{app.category}</p>
          <p className="text-sm text-muted-foreground leading-snug mt-2">{app.description}</p>
        </div>

        {/* Action */}
        <div className="pt-1">
          {isLive && app.href ? (
            <Link href={app.href}>
              <Button
                size="sm"
                className="w-full gap-1.5"
                style={{ background: "hsl(216,40%,30%)", color: "white" }}
                data-testid={`button-launch-${app.id}`}
              >
                Launch App
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          ) : isBeta ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              disabled
              data-testid={`button-launch-${app.id}`}
            >
              Request Beta Access
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled
              data-testid={`button-launch-${app.id}`}
            >
              Notify Me
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AppsPage() {
  const liveApps = apps.filter(a => a.status === "live");
  const betaApps = apps.filter(a => a.status === "beta");
  const comingSoonApps = apps.filter(a => a.status === "coming-soon");

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">HealthTrixss Apps</h1>
        <p className="text-sm text-muted-foreground">
          Your suite of healthcare business tools. Launch apps, explore what's in beta, and stay informed about what's coming.
        </p>
      </div>

      {/* Live apps */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Available Now</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
            {liveApps.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {liveApps.map(app => <AppCard key={app.id} app={app} />)}
        </div>
      </section>

      {/* Beta apps */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">In Beta</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
            {betaApps.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {betaApps.map(app => <AppCard key={app.id} app={app} />)}
        </div>
      </section>

      {/* Coming soon */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Coming Soon</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
            {comingSoonApps.length}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {comingSoonApps.map(app => <AppCard key={app.id} app={app} />)}
        </div>
      </section>
    </div>
  );
}
