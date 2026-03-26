import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function LeadGenReportsPage() {
  const [runFilter, setRunFilter] = useState<string>("all");

  const { data: runs } = useQuery<LeadGenerationRun[]>({
    queryKey: ["/api/lead-gen/runs"],
  });

  const queryParams = new URLSearchParams();
  if (runFilter && runFilter !== "all") queryParams.set("runId", runFilter);

  const { data: report, isLoading } = useQuery<ReportData>({
    queryKey: ["/api/lead-gen/reports", queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/lead-gen/reports?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const rows = report?.rows ?? [];
  const icpRows = report?.icpRows ?? [];
  const staleDeferred = report?.staleDeferred ?? [];
  const totals = report?.totals;

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
        <>
          {/* Summary Cards */}
          {totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Candidates", value: totals.totalCandidates, testid: "stat-report-total" },
                { label: "Approved", value: totals.approved, testid: "stat-report-approved" },
                { label: "Conversion Rate", value: `${Math.round(totals.conversionRate)}%`, testid: "stat-report-conversion" },
                { label: "Tasks Created", value: totals.tasksCreated, testid: "stat-report-tasks" },
              ].map(stat => (
                <Card key={stat.label} data-testid={stat.testid}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-2xl font-bold">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Approval Rate by ICP — Bar Chart */}
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

          {/* Duplicate Rate by ICP — Bar Chart */}
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

          {/* Duplicate Rate Over Time — Line Chart */}
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

          {/* Task Generation Success — Run-level card */}
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

          {/* Run-level performance table */}
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
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Conv. Rate</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Tasks</th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Dup %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.runId} className="border-b" data-testid={`row-report-${row.runId}`}>
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
        </>
      )}
    </div>
  );
}
