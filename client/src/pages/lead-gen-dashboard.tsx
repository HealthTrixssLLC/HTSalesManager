import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingUp, Users, CheckCircle, AlertTriangle, ListChecks, Calendar, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface DashboardStats {
  activeRuns: number;
  pendingReview: number;
  approvalsToday: number;
  duplicatesFlagged: number;
  tasksCreated: number;
  meetingsBooked: number;
}

function StatCard({ title, value, icon: Icon, href, color }: {
  title: string;
  value: number;
  icon: LucideIcon;
  href?: string;
  color?: string;
}) {
  const content = (
    <Card className="hover-elevate cursor-pointer" data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

export default function LeadGenDashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/lead-gen/dashboard"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Lead Gen Dashboard</h1>
          <p className="text-muted-foreground">Overview of your lead generation activity</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" data-testid="button-view-runs">
            <Link href="/lead-gen/runs">View Runs</Link>
          </Button>
          <Button asChild data-testid="button-go-to-review">
            <Link href="/lead-gen/review">Review Queue</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Active Runs" value={stats?.activeRuns ?? 0} icon={TrendingUp} href="/lead-gen/runs" color="text-blue-500" />
        <StatCard title="Pending Review" value={stats?.pendingReview ?? 0} icon={Users} href="/lead-gen/review" color="text-amber-500" />
        <StatCard title="Approvals Today" value={stats?.approvalsToday ?? 0} icon={CheckCircle} color="text-green-500" />
        <StatCard title="Duplicates Flagged" value={stats?.duplicatesFlagged ?? 0} icon={AlertTriangle} color="text-red-500" />
        <StatCard title="Tasks Created" value={stats?.tasksCreated ?? 0} icon={ListChecks} color="text-purple-500" />
        <StatCard title="Meetings Booked" value={stats?.meetingsBooked ?? 0} icon={Calendar} color="text-teal-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild variant="outline" className="justify-start" data-testid="button-new-icp">
              <Link href="/lead-gen/icps">Manage ICPs</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start" data-testid="button-new-playbook">
              <Link href="/lead-gen/playbooks">Manage Task Playbooks</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start" data-testid="button-new-run">
              <Link href="/lead-gen/runs">Create / Manage Runs</Link>
            </Button>
            <Button asChild variant="outline" className="justify-start" data-testid="button-view-reports">
              <Link href="/lead-gen/reports">View Reports</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Module Overview</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>The Lead Generation Module allows your team to manage the full lead development pipeline from Ideal Customer Profile (ICP) definition through candidate review and CRM lead creation.</p>
            <p>Start by creating an ICP, then define a Task Playbook. Launch a Run, stage candidates, and review them in the Review Queue.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
