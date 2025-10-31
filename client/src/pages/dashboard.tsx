// Dashboard page with stat cards and charts
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Building2, Users, Target as TargetIcon, TrendingUp, Loader2, DollarSign, Save } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceLine } from "recharts";

type DashboardStats = {
  totalAccounts: number;
  totalContacts: number;
  totalLeads: number;
  totalOpportunities: number;
  pipelineByStage: { stage: string; count: number; value: number }[];
  newLeadsThisMonth: number;
  winRate: number;
  activitiesByUser: { userName: string; count: number }[];
};

type OpportunityData = {
  name: string;
  amount: number;
  stage: string;
  closeDate: string | null;
};

type WaterfallDataPoint = {
  name: string;
  value: number;
  cumulative: number;
  isTotal?: boolean;
  isTarget?: boolean;
};

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function Dashboard() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [salesTarget, setSalesTarget] = useState<number>(() => {
    const saved = localStorage.getItem(`salesTarget_${currentYear}`);
    return saved ? parseFloat(saved) : 1000000;
  });
  const [targetInput, setTargetInput] = useState(salesTarget.toString());

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: opportunities } = useQuery<OpportunityData[]>({
    queryKey: ["/api/dashboard/sales-waterfall", selectedYear],
  });

  useEffect(() => {
    const saved = localStorage.getItem(`salesTarget_${selectedYear}`);
    const target = saved ? parseFloat(saved) : 1000000;
    setSalesTarget(target);
    setTargetInput(target.toString());
  }, [selectedYear]);

  const handleSaveTarget = () => {
    const newTarget = parseFloat(targetInput) || 1000000;
    setSalesTarget(newTarget);
    localStorage.setItem(`salesTarget_${selectedYear}`, newTarget.toString());
  };

  // Build waterfall data
  const waterfallData: WaterfallDataPoint[] = [];
  if (opportunities) {
    let cumulative = 0;
    
    // Add target as reference
    waterfallData.push({
      name: `${selectedYear} Target`,
      value: salesTarget,
      cumulative: salesTarget,
      isTarget: true,
    });
    
    // Add each opportunity
    opportunities.forEach((opp, index) => {
      cumulative += opp.amount;
      waterfallData.push({
        name: opp.name.length > 15 ? opp.name.substring(0, 15) + "..." : opp.name,
        value: opp.amount,
        cumulative: cumulative,
      });
    });
    
    // Add gap/surplus
    const gap = salesTarget - cumulative;
    if (gap > 0) {
      waterfallData.push({
        name: "Gap to Target",
        value: gap,
        cumulative: salesTarget,
        isTotal: true,
      });
    } else {
      waterfallData.push({
        name: "Over Target",
        value: 0,
        cumulative: cumulative,
        isTotal: true,
      });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your sales pipeline and activities</p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Accounts</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-total-accounts">{stats?.totalAccounts || 0}</div>
            <p className="text-xs text-muted-foreground">Active customer accounts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contacts</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-total-contacts">{stats?.totalContacts || 0}</div>
            <p className="text-xs text-muted-foreground">Across all accounts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Leads</CardTitle>
            <TargetIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-total-leads">{stats?.totalLeads || 0}</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-primary font-medium">+{stats?.newLeadsThisMonth || 0}</span> this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold" data-testid="stat-win-rate">{stats?.winRate || 0}%</div>
            <p className="text-xs text-muted-foreground">{stats?.totalOpportunities || 0} opportunities</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Sales Waterfall - {selectedYear}</CardTitle>
                <CardDescription>Opportunities progress toward annual target</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value) || currentYear)}
                  className="w-24"
                  data-testid="input-year"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Label className="text-sm">Annual Target ($):</Label>
              <Input
                type="number"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                className="w-32"
                data-testid="input-sales-target"
              />
              <Button size="sm" onClick={handleSaveTarget} data-testid="button-save-target">
                <Save className="h-3 w-3 mr-1" />
                Save
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={waterfallData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={10}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, "Amount"]}
                />
                <ReferenceLine 
                  y={salesTarget} 
                  stroke="hsl(var(--destructive))" 
                  strokeDasharray="3 3"
                  label={{ value: "Target", position: "right", fill: "hsl(var(--destructive))" }}
                />
                <Bar 
                  dataKey="value" 
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative" 
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--chart-2))", r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Target</p>
                <p className="font-semibold">${salesTarget.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Actual</p>
                <p className="font-semibold">${waterfallData.reduce((sum, d) => !d.isTarget && !d.isTotal ? sum + d.value : sum, 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Gap</p>
                <p className="font-semibold text-destructive">
                  ${Math.max(0, salesTarget - waterfallData.reduce((sum, d) => !d.isTarget && !d.isTotal ? sum + d.value : sum, 0)).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activities by User</CardTitle>
            <CardDescription>Distribution of activities across team members</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={stats?.activitiesByUser || []}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ userName, count }) => `${userName}: ${count}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {(stats?.activitiesByUser || []).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                  }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
