// Dashboard page with stat cards and charts
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Users, Target as TargetIcon, TrendingUp, Loader2, DollarSign, Save, Download } from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceLine } from "recharts";
import { UpcomingActivitiesCard } from "@/components/upcoming-activities-card";
import { useToast } from "@/hooks/use-toast";

type DashboardStats = {
  totalAccounts: number;
  totalContacts: number;
  totalLeads: number;
  totalOpportunities: number;
  pipelineByStage: { stage: string; count: number; value: number }[];
  newLeadsThisMonth: number;
  winRate: number;
  opportunitiesByCloseDate: { 
    period: string; 
    count: number; 
    value: number; 
    opportunities: { id: string; name: string; amount: number; closeDate: string | null }[] 
  }[];
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
  base?: number;
  isTotal?: boolean;
  isTarget?: boolean;
  stageIndex?: number;
};

// Sales pipeline stages in order
const PIPELINE_STAGES = [
  { key: "prospecting", label: "Prospecting" },
  { key: "qualification", label: "Qualification" },
  { key: "proposal", label: "Proposal" },
  { key: "negotiation", label: "Negotiation" },
  { key: "closed_won", label: "Closed Won" },
  { key: "closed_lost", label: "Closed Lost" },
];

const STAGE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(186, 78%, 32%)", // Health Trixss primary teal
];

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
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportFilters, setReportFilters] = useState({
    accountId: "",
    rating: "",
    startDate: "",
    endDate: ""
  });
  const { toast } = useToast();

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: opportunities } = useQuery<OpportunityData[]>({
    queryKey: ["/api/dashboard/sales-waterfall", selectedYear],
  });

  const { data: accounts } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/accounts"],
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

  const handleDownloadReport = async () => {
    try {
      const params = new URLSearchParams();
      if (reportFilters.accountId) params.append("accountId", reportFilters.accountId);
      if (reportFilters.rating) params.append("rating", reportFilters.rating);
      if (reportFilters.startDate) params.append("startDate", reportFilters.startDate);
      if (reportFilters.endDate) params.append("endDate", reportFilters.endDate);
      
      const response = await fetch(`/api/reports/sales-forecast?${params.toString()}`, {
        credentials: "include"
      });
      
      if (!response.ok) {
        throw new Error("Failed to generate report");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sales-forecast-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      setIsReportDialogOpen(false);
      toast({ title: "Report downloaded successfully" });
    } catch (error) {
      toast({ title: "Failed to download report", variant: "destructive" });
    }
  };

  // Build waterfall data by stage (each stage starts where previous ended)
  // Note: Closed Lost is shown separately as it doesn't contribute to target
  const waterfallData: WaterfallDataPoint[] = [];
  const closedLostData: WaterfallDataPoint[] = [];
  
  if (opportunities) {
    // Aggregate opportunities by stage
    const stageValues = new Map<string, number>();
    opportunities.forEach(opp => {
      const current = stageValues.get(opp.stage) || 0;
      stageValues.set(opp.stage, current + opp.amount);
    });

    // Calculate total excluding closed_lost
    const totalActual = opportunities
      .filter(opp => opp.stage !== "closed_lost")
      .reduce((sum, opp) => sum + opp.amount, 0);
    const gap = Math.max(0, salesTarget - totalActual);
    let cumulative = 0;
    
    // Start with Gap to Target (if exists)
    if (gap > 0) {
      waterfallData.push({
        name: "Gap to Target",
        value: gap,
        cumulative: gap,
        isTotal: true,
        stageIndex: -1,
      });
      cumulative = gap;
    }
    
    // Add progressive stages (excluding closed_lost)
    PIPELINE_STAGES.filter(stage => stage.key !== "closed_lost").forEach((stage, index) => {
      const value = stageValues.get(stage.key) || 0;
      waterfallData.push({
        name: stage.label,
        value: value,
        cumulative: cumulative + value,
        stageIndex: index,
      });
      cumulative += value;
    });
    
    // Add Closed Lost separately (not part of waterfall progression)
    const closedLostValue = stageValues.get("closed_lost") || 0;
    if (closedLostValue > 0) {
      closedLostData.push({
        name: "Closed Lost",
        value: closedLostValue,
        cumulative: closedLostValue,
        stageIndex: 99, // Special index for styling
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your sales pipeline and activities</p>
        </div>
        <Button onClick={() => setIsReportDialogOpen(true)} data-testid="button-download-forecast">
          <Download className="h-4 w-4 mr-2" />
          Download Sales Forecast
        </Button>
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
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-10">
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart 
                    data={waterfallData.map((d, i) => ({
                      ...d,
                      base: i === 0 ? 0 : waterfallData[i - 1].cumulative,
                    }))}
                  >
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
                      formatter={(value: number, name: string) => {
                        if (name === "base") return null;
                        return [`$${value.toLocaleString()}`, "Amount"];
                      }}
                      labelFormatter={(label) => label}
                    />
                    <ReferenceLine 
                      y={salesTarget} 
                      stroke="hsl(var(--destructive))" 
                      strokeDasharray="3 3"
                      label={{ value: `Target: $${salesTarget.toLocaleString()}`, position: "right", fill: "hsl(var(--destructive))", fontSize: 12 }}
                    />
                    <Bar 
                      dataKey="base" 
                      stackId="waterfall"
                      fill="transparent"
                    />
                    <Bar 
                      dataKey="value" 
                      stackId="waterfall"
                      radius={[4, 4, 0, 0]}
                      label={{
                        position: 'top',
                        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
                        fontSize: 10,
                      }}
                    >
                      {waterfallData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={
                            entry.isTotal 
                              ? "hsl(var(--destructive))" 
                              : STAGE_COLORS[entry.stageIndex! % STAGE_COLORS.length]
                          }
                        />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {closedLostData.length > 0 && (
                <div className="col-span-2 flex flex-col items-center justify-end pb-20">
                  <div className="text-xs text-muted-foreground mb-1 text-center">Closed Lost</div>
                  <div 
                    className="w-full rounded-md flex items-end justify-center"
                    style={{
                      height: `${Math.min(300, (closedLostData[0].value / salesTarget) * 300)}px`,
                      backgroundColor: "hsl(var(--muted))",
                      opacity: 0.6,
                    }}
                  >
                    <div className="text-xs font-medium text-muted-foreground mb-2">
                      ${(closedLostData[0].value / 1000).toFixed(0)}k
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Target</p>
                <p className="font-semibold">${salesTarget.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Actual Pipeline</p>
                <p className="font-semibold text-primary">${waterfallData.filter(d => !d.isTotal).reduce((sum, d) => sum + d.value, 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Gap to Close</p>
                <p className="font-semibold text-destructive">
                  ${(waterfallData.find(d => d.isTotal)?.value || 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Closed Lost</p>
                <p className="font-semibold text-muted-foreground">
                  ${(closedLostData[0]?.value || 0).toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Opportunities by Close Date</CardTitle>
            <CardDescription>Pipeline forecast by time period (next 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={stats?.opportunitiesByCloseDate || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="period" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={11}
                  tickFormatter={(value) => {
                    if (value === "No Date") return value;
                    const [year, month] = value.split('-');
                    const date = new Date(parseInt(year), parseInt(month) - 1);
                    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                  }}
                />
                <YAxis 
                  yAxisId="left"
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <YAxis 
                  yAxisId="right"
                  orientation="right"
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  label={{ value: 'Value', angle: 90, position: 'insideRight', fontSize: 11 }}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "count") return [value, "Opportunities"];
                    return [`$${value.toLocaleString()}`, "Total Value"];
                  }}
                  labelFormatter={(label) => {
                    if (label === "No Date") return label;
                    const [year, month] = label.split('-');
                    const date = new Date(parseInt(year), parseInt(month) - 1);
                    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  }}
                />
                <Bar 
                  yAxisId="left"
                  dataKey="count" 
                  fill="hsl(var(--chart-1))"
                  radius={[4, 4, 0, 0]}
                  name="count"
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="value" 
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: "hsl(var(--primary))", r: 4 }}
                  name="value"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Activities */}
      <UpcomingActivitiesCard />

      {/* Sales Forecast Report Dialog */}
      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download Sales Forecast Report</DialogTitle>
            <DialogDescription>
              Generate an Excel report with opportunity details, executive summary, and monthly forecast. Apply optional filters to refine the data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="filter-account">Filter by Account (Optional)</Label>
              <Select 
                value={reportFilters.accountId || undefined} 
                onValueChange={(value) => setReportFilters(prev => ({ ...prev, accountId: value || "" }))}
              >
                <SelectTrigger id="filter-account" data-testid="select-filter-account">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-rating">Filter by Rating (Optional)</Label>
              <Select 
                value={reportFilters.rating || undefined} 
                onValueChange={(value) => setReportFilters(prev => ({ ...prev, rating: value || "" }))}
              >
                <SelectTrigger id="filter-rating" data-testid="select-filter-rating">
                  <SelectValue placeholder="All ratings" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">Hot</SelectItem>
                  <SelectItem value="warm">Warm</SelectItem>
                  <SelectItem value="cold">Cold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="filter-start-date">Start Date (Optional)</Label>
                <Input
                  id="filter-start-date"
                  type="date"
                  value={reportFilters.startDate}
                  onChange={(e) => setReportFilters(prev => ({ ...prev, startDate: e.target.value }))}
                  data-testid="input-filter-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="filter-end-date">End Date (Optional)</Label>
                <Input
                  id="filter-end-date"
                  type="date"
                  value={reportFilters.endDate}
                  onChange={(e) => setReportFilters(prev => ({ ...prev, endDate: e.target.value }))}
                  data-testid="input-filter-end-date"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReportDialogOpen(false)} data-testid="button-cancel-report">
              Cancel
            </Button>
            <Button onClick={handleDownloadReport} data-testid="button-confirm-download">
              <Download className="h-4 w-4 mr-2" />
              Download Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
