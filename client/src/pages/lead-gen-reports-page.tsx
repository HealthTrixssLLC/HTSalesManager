import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Clock, Users, TrendingUp, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocation } from "wouter";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { LeadGenerationRun } from "@shared/schema";

interface ReportRow {
  runId: string;
  runName: string;
  icpProfileId: string | null;
  totalCandidates: number;
  reviewed: number;
  approved: number;
  rejected: number;
  deferred: number;
  conversionRate: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  uniqueCount: number;
  possibleDuplicateCount: number;
  confirmedDuplicateCount: number;
  tasksCreated: number;
  taskGenerationRate: number;
  duplicateRate: number;
}

interface IcpReportRow {
  icpId: string;
  icpName: string;
  total: number;
  approved: number;
  duplicates: number;
  approvalRate: number;
  duplicateRate: number;
}

interface StaleDeferredRow {
  id: string;
  accountName: string;
  runName: string;
  deferredDaysAgo: number;
}

interface ReportData {
  rows: ReportRow[];
  icpRows: IcpReportRow[];
  staleDeferred: StaleDeferredRow[];
  totals: {
    totalCandidates: number;
    reviewed: number;
    approved: number;
    rejected: number;
    deferred: number;
    tasksCreated: number;
    conversionRate: number;
    taskGenerationRate: number;
  };
}

interface RunCard {
  runId: string;
  runName: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  totalCandidates: number;
  approved: number;
  rejected: number;
  deferred: number;
  approvalRate: number;
  avgIcpFitScore: number | null;
  timeToFirstPromotion: number | null;
}

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

const runStatusColors: Record<string, string> = {
  draft: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  reviewing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  complete: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  archived: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
};

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

export default function LeadGenReportsPage() {
  const [runFilter, setRunFilter] = useState<string>("all");
  const [, setLocation] = useLocation();

  const { data: runs } = useQuery<LeadGenerationRun[]>({
    queryKey: ["/api/lead-gen/runs"],
  });

  const queryParams = new URLSearchParams();
  if (runFilter && runFilter !== "all") queryParams.set("runId", runFilter);

  const { data: report, isLoading: reportLoading } = useQuery<ReportData>({
    queryKey: ["/api/lead-gen/reports", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/reports?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const { data: runCards = [], isLoading: runCardsLoading } = useQuery<RunCard[]>({
    queryKey: ["/api/lead-gen/reports/run-cards"],
    queryFn: async () => {
      const res = await fetch("/api/lead-gen/reports/run-cards", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load run cards");
      return res.json();
    },
  });

  const rows = report?.rows ?? [];
  const icpRows = report?.icpRows ?? [];
  const staleDeferred = report?.staleDeferred ?? [];
  const totals = report?.totals;

  const filteredRunCards = runFilter === "all"
    ? runCards
    : runCards.filter(rc => rc.runId === runFilter);

  const isLoading = reportLoading || runCardsLoading;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Lead Gen Reports</h1>
          <p className="text-muted-foreground">Candidate pipeline performance by run</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label className="shrink-0">Run</Label>
          <Select value={runFilter} onValueChange={setRunFilter}>
            <SelectTrigger className="w-56" data-testid="select-report-run">
              <SelectValue placeholder="All Runs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Runs</SelectItem>
              {runs?.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Tabs defaultValue="run-cards" data-testid="reports-tabs">
          <TabsList>
            <TabsTrigger value="run-cards" data-testid="tab-run-cards">Run Summary Cards</TabsTrigger>
            <TabsTrigger value="analytics" data-testid="tab-analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* Run Cards Tab */}
          <TabsContent value="run-cards" className="space-y-4">
            {/* Summary Stats */}
            {totals && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Total Candidates", value: totals.totalCandidates, testid: "stat-report-total", icon: Users },
                  { label: "Approved", value: totals.approved, testid: "stat-report-approved", icon: TrendingUp },
                  { label: "Approval Rate", value: `${Math.round(totals.conversionRate)}%`, testid: "stat-report-conversion", icon: Target },
                  { label: "Tasks Created", value: totals.tasksCreated, testid: "stat-report-tasks", icon: Clock },
                ].map(stat => {
                  const Icon = stat.icon;
                  return (
                    <Card key={stat.label} data-testid={stat.testid}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-2xl font-bold">{stat.value}</p>
                            <p className="text-xs text-muted-foreground">{stat.label}</p>
                          </div>
                          <Icon className="h-5 w-5 text-muted-foreground/60 mt-0.5" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Per-run cards */}
            {filteredRunCards.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No run data available. Create runs and stage candidates to see reporting.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredRunCards.map(rc => (
                  <Card
                    key={rc.runId}
                    data-testid={`run-card-${rc.runId}`}
                    className="hover-elevate cursor-pointer"
                    onClick={() => setLocation(`/lead-gen/runs/${rc.runId}`)}
                  >
                    <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-sm font-semibold truncate" data-testid={`run-card-name-${rc.runId}`}>
                          {rc.runName}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {rc.startedAt ? new Date(rc.startedAt).toLocaleDateString() : new Date(rc.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md shrink-0 ${runStatusColors[rc.status] ?? ""}`} data-testid={`run-card-status-${rc.runId}`}>
                        {rc.status}
                      </span>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-3">
                      {/* Key metrics grid */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Candidates</p>
                          <p className="font-semibold" data-testid={`run-card-candidates-${rc.runId}`}>{rc.totalCandidates}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Approval Rate</p>
                          <p className={`font-semibold ${rc.approvalRate >= 50 ? "text-green-600 dark:text-green-400" : rc.approvalRate >= 20 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`run-card-approval-rate-${rc.runId}`}>
                            {rc.approvalRate}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Avg ICP Fit</p>
                          <p className={`font-semibold ${rc.avgIcpFitScore !== null && rc.avgIcpFitScore >= 60 ? "text-green-600 dark:text-green-400" : rc.avgIcpFitScore !== null && rc.avgIcpFitScore >= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`run-card-avg-icp-${rc.runId}`}>
                            {rc.avgIcpFitScore !== null ? `${rc.avgIcpFitScore}%` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Time to First Promo</p>
                          <p className="font-semibold" data-testid={`run-card-time-promo-${rc.runId}`}>
                            {formatDuration(rc.timeToFirstPromotion)}
                          </p>
                        </div>
                      </div>

                      {/* Approval breakdown bar */}
                      {rc.totalCandidates > 0 && (
                        <div className="space-y-1">
                          <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
                            {rc.approved > 0 && (
                              <div
                                className="bg-green-500 dark:bg-green-400"
                                style={{ flex: rc.approved }}
                                title={`Approved: ${rc.approved}`}
                              />
                            )}
                            {rc.rejected > 0 && (
                              <div
                                className="bg-red-400 dark:bg-red-500"
                                style={{ flex: rc.rejected }}
                                title={`Rejected: ${rc.rejected}`}
                              />
                            )}
                            {rc.deferred > 0 && (
                              <div
                                className="bg-amber-400 dark:bg-amber-500"
                                style={{ flex: rc.deferred }}
                                title={`Deferred: ${rc.deferred}`}
                              />
                            )}
                            {(rc.totalCandidates - rc.approved - rc.rejected - rc.deferred) > 0 && (
                              <div
                                className="bg-gray-200 dark:bg-gray-700"
                                style={{ flex: rc.totalCandidates - rc.approved - rc.rejected - rc.deferred }}
                                title="Pending"
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{rc.approved} approved</span>
                            <span>{rc.rejected} rejected</span>
                            <span>{rc.deferred} deferred</span>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-4">
            {/* Approval Rate by ICP */}
            {icpRows.length > 0 && (
              <Card data-testid="chart-approval-by-icp">
                <CardHeader>
                  <CardTitle className="text-base">Approval Rate by ICP</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={icpRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="icpName" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${Math.round(value)}%`, "Approval Rate"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="approvalRate" name="Approval Rate" radius={[3, 3, 0, 0]}>
                        {icpRows.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Duplicate Rate by ICP */}
            {icpRows.length > 0 && (
              <Card data-testid="chart-duplicate-by-icp">
                <CardHeader>
                  <CardTitle className="text-base">Duplicate Rate by ICP</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={icpRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="icpName" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${Math.round(value)}%`, "Duplicate Rate"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="duplicateRate" name="Duplicate Rate" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Duplicate Rate Over Time */}
            {rows.length > 0 && (
              <Card data-testid="chart-duplicate-rate-over-time">
                <CardHeader>
                  <CardTitle className="text-base">Duplicate Rate Over Time (by Run)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="runName" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${Math.round(value)}%`, "Duplicate Rate"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Line type="monotone" dataKey="duplicateRate" name="Duplicate Rate" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Task Generation Success */}
            {rows.length > 0 && (
              <Card data-testid="chart-task-generation">
                <CardHeader>
                  <CardTitle className="text-base">Task Generation Success by Run</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="runName" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `${v}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${Math.round(value)}%`, "Task Gen Rate"]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Bar dataKey="taskGenerationRate" name="Task Generation Rate" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Performance Table */}
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No data available. Create runs and stage candidates to see reporting.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Performance by Run</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-4 font-medium text-muted-foreground">Run</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Reviewed</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Approved</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Rejected</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Deferred</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Approval %</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Tasks</th>
                          <th className="text-right py-3 px-4 font-medium text-muted-foreground">Dup %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => (
                          <tr key={row.runId} className="border-b hover-elevate cursor-pointer" onClick={() => setLocation(`/lead-gen/runs/${row.runId}`)} data-testid={`row-report-${row.runId}`}>
                            <td className="py-3 px-4 font-medium">{row.runName}</td>
                            <td className="py-3 px-4 text-right">{row.totalCandidates}</td>
                            <td className="py-3 px-4 text-right">{row.reviewed}</td>
                            <td className="py-3 px-4 text-right text-green-600 font-medium">{row.approved}</td>
                            <td className="py-3 px-4 text-right text-destructive">{row.rejected}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{row.deferred}</td>
                            <td className="py-3 px-4 text-right font-medium">{Math.round(row.conversionRate)}%</td>
                            <td className="py-3 px-4 text-right">{row.tasksCreated}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{Math.round(row.duplicateRate)}%</td>
                          </tr>
                        ))}
                      </tbody>
                      {rows.length > 1 && totals && (
                        <tfoot>
                          <tr className="border-t bg-muted/40 font-medium">
                            <td className="py-3 px-4">Totals</td>
                            <td className="py-3 px-4 text-right">{totals.totalCandidates}</td>
                            <td className="py-3 px-4 text-right">{totals.reviewed}</td>
                            <td className="py-3 px-4 text-right text-green-600">{totals.approved}</td>
                            <td className="py-3 px-4 text-right text-destructive">{totals.rejected}</td>
                            <td className="py-3 px-4 text-right text-muted-foreground">{totals.deferred}</td>
                            <td className="py-3 px-4 text-right">{Math.round(totals.conversionRate)}%</td>
                            <td className="py-3 px-4 text-right">{totals.tasksCreated}</td>
                            <td className="py-3 px-4 text-right" />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Stale Deferred Queue */}
            <Card data-testid="table-stale-deferred">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Stale Deferred Queue
                  {staleDeferred.length > 0 && (
                    <Badge variant="outline" className="text-xs">{staleDeferred.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {staleDeferred.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No stale deferred candidates — all deferred candidates were updated within the last 7 days.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground">Account</th>
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground">Run</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Deferred (days ago)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staleDeferred.map(row => (
                          <tr key={row.id} className="border-b" data-testid={`row-stale-${row.id}`}>
                            <td className="py-2 px-3 font-medium">{row.accountName}</td>
                            <td className="py-2 px-3 text-muted-foreground">{row.runName}</td>
                            <td className="py-2 px-3 text-right">
                              <span className={row.deferredDaysAgo > 14 ? "text-destructive font-medium" : "text-amber-600"}>
                                {row.deferredDaysAgo}d
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
