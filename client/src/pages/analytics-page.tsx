import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, Target, Zap, Users, AlertTriangle, Filter } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const DEFAULT_SELECTED_ROLES = ["Admin", "SalesRep"];

export default function AnalyticsPage() {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(DEFAULT_SELECTED_ROLES);

  const { data: availableRoles } = useQuery<string[]>({ queryKey: ["/api/analytics/role-names"] });

  const rolesQueryParam = selectedRoles.join(",");
  const hasRolesSelected = selectedRoles.length > 0;
  const repPerformanceUrl = `/api/analytics/rep-performance?roles=${encodeURIComponent(rolesQueryParam)}`;

  const { data: forecast } = useQuery<any>({ queryKey: ["/api/analytics/forecast"] });
  const { data: historical } = useQuery<any>({ queryKey: ["/api/analytics/historical"] });
  const { data: velocity } = useQuery<any>({ queryKey: ["/api/analytics/velocity"] });
  const { data: conversions } = useQuery<any>({ queryKey: ["/api/analytics/conversions"] });
  const { data: predictions } = useQuery<any>({ queryKey: ["/api/analytics/predictions"] });
  const { data: repPerformance, isLoading: repLoading } = useQuery<any>({
    queryKey: ["/api/analytics/rep-performance", rolesQueryParam],
    queryFn: async () => {
      const res = await fetch(repPerformanceUrl, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`${res.status}: ${await res.text() || res.statusText}`);
      }
      return res.json();
    },
    enabled: hasRolesSelected,
  });
  const { data: repTimeseries } = useQuery<any>({ queryKey: ["/api/analytics/rep-performance/timeseries"] });
  const { data: repPipelineStages } = useQuery<any>({ queryKey: ["/api/analytics/rep-performance/pipeline-stages"] });
  const { data: pipelineHealth } = useQuery<any>({ queryKey: ["/api/analytics/pipeline-health"] });

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const rolesList = availableRoles || DEFAULT_SELECTED_ROLES;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="analytics-page">
      <div>
        <h1 className="text-2xl font-semibold mb-2" data-testid="text-analytics-title">Analytics & Forecasting</h1>
        <p className="text-muted-foreground">
          OKR-driven insights measuring outcomes and drivers, not activities
        </p>
      </div>

      <Tabs defaultValue="executive" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="executive" data-testid="tab-executive">Executive</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">Forecast</TabsTrigger>
          <TabsTrigger value="velocity" data-testid="tab-velocity">Velocity</TabsTrigger>
          <TabsTrigger value="reps" data-testid="tab-reps">Rep Performance</TabsTrigger>
        </TabsList>

        {/* EXECUTIVE DASHBOARD */}
        <TabsContent value="executive" className="space-y-6">
          {/* Key Metrics Row */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Revenue (This Month)</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-revenue">
                  {forecast ? formatCurrency(forecast.closedRevenue) : "—"}
                </div>
                {forecast && (
                  <p className="text-xs text-muted-foreground">
                    +{formatCurrency(forecast.forecasts.mostLikely)} forecast remaining
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-winrate">
                  {historical ? formatPercent(historical.winRate) : "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {historical?.wonCount || 0} won / {historical?.totalClosed || 0} closed
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Deal Size</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-avgdeal">
                  {historical ? formatCurrency(historical.avgDealSize) : "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Based on last 90 days
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sales Cycle</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-salescycle">
                  {historical ? `${Math.round(historical.avgSalesCycle)}d` : "—"}
                </div>
                <p className="text-xs text-muted-foreground">
                  Average days to close
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Pipeline Health Score */}
          {pipelineHealth && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Pipeline Health Score
                  <Badge variant={pipelineHealth.score >= 70 ? "default" : "destructive"}>
                    {pipelineHealth.score}/100
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Composite score based on coverage, distribution, velocity, and freshness
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Coverage</span>
                      <span className="text-sm text-muted-foreground">
                        {pipelineHealth.components.pipelineCoverage}%
                      </span>
                    </div>
                    <Progress value={pipelineHealth.components.pipelineCoverage} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Distribution</span>
                      <span className="text-sm text-muted-foreground">
                        {pipelineHealth.components.stageDistribution}%
                      </span>
                    </div>
                    <Progress value={pipelineHealth.components.stageDistribution} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Velocity</span>
                      <span className="text-sm text-muted-foreground">
                        {pipelineHealth.components.velocity}%
                      </span>
                    </div>
                    <Progress value={pipelineHealth.components.velocity} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">Freshness</span>
                      <span className="text-sm text-muted-foreground">
                        {pipelineHealth.components.freshness}%
                      </span>
                    </div>
                    <Progress value={pipelineHealth.components.freshness} />
                  </div>
                </div>

                {pipelineHealth.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Recommendations:</h4>
                    <ul className="space-y-1">
                      {pipelineHealth.recommendations.map((rec: string, idx: number) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* FORECAST DASHBOARD */}
        <TabsContent value="forecast" className="space-y-6">
          {forecast && (
            <>
              {/* Forecast Overview */}
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Conservative</CardTitle>
                    <CardDescription>Based on historical win rate</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-forecast-conservative">
                      {formatCurrency(forecast.forecasts.conservative)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatPercent(forecast.historicalMetrics.winRate)} win rate
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-primary">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Most Likely</CardTitle>
                    <CardDescription>Stage-weighted forecast</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary" data-testid="text-forecast-likely">
                      {formatCurrency(forecast.forecasts.mostLikely)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Probability-adjusted pipeline
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Commit</CardTitle>
                    <CardDescription>High probability deals (80%+)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-forecast-commit">
                      {formatCurrency(forecast.forecasts.optimistic)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Late-stage opportunities
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Forecast Waterfall */}
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Forecast Breakdown</CardTitle>
                  <CardDescription>
                    Closed + Forecasted revenue for the period
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Closed (Actual)</span>
                      <span className="text-lg font-bold" data-testid="text-closed-actual">
                        {formatCurrency(forecast.closedRevenue)}
                      </span>
                    </div>
                    <Progress 
                      value={(forecast.closedRevenue / (forecast.closedRevenue + forecast.forecasts.mostLikely)) * 100} 
                      className="h-2"
                    />
                    
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Most Likely Forecast</span>
                      <span className="text-lg font-bold" data-testid="text-forecast-remaining">
                        {formatCurrency(forecast.forecasts.mostLikely)}
                      </span>
                    </div>
                    <Progress 
                      value={(forecast.forecasts.mostLikely / forecast.openPipeline) * 100} 
                      className="h-2"
                    />

                    <div className="flex items-center justify-between pt-4 border-t">
                      <span className="font-bold">Total Expected</span>
                      <span className="text-2xl font-bold text-primary">
                        {formatCurrency(forecast.closedRevenue + forecast.forecasts.mostLikely)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Deal Predictions */}
              {predictions && predictions.likelyClosers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Likely to Close (Next 30 Days)</CardTitle>
                    <CardDescription>
                      {predictions.summary.likelyClosers} deals with 70%+ probability
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {predictions.likelyClosers.slice(0, 5).map((deal: any) => (
                        <div key={deal.id} className="flex items-center justify-between p-3 border rounded-lg hover-elevate">
                          <div className="flex-1">
                            <div className="font-medium">{deal.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {deal.accountName} • Closes in {deal.daysUntilClose} days
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-bold">{formatCurrency(deal.amount)}</div>
                            <div className="text-sm text-muted-foreground">
                              {formatPercent(deal.probability)} likely
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* VELOCITY DASHBOARD */}
        <TabsContent value="velocity" className="space-y-6">
          {velocity && conversions && (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Pipeline Velocity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-velocity">
                      {formatCurrency(velocity.velocityPerDay)}/day
                    </div>
                    <p className="text-xs text-muted-foreground">
                      ${(velocity.velocityPerDay * 30).toFixed(0)} per month
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Deals Moved</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-deals-moved">
                      {velocity.opportunitiesMoved}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last {Math.round(velocity.days)} days
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">Total Value Moved</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-value-moved">
                      {formatCurrency(velocity.totalValue)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Pipeline movement
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Stage Conversion Funnel */}
              <Card>
                <CardHeader>
                  <CardTitle>Stage Conversion Rates</CardTitle>
                  <CardDescription>
                    How deals move through your pipeline
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(conversions.conversions).map(([key, value]: [string, any]) => {
                      const label = key.replace(/_/g, " → ").replace(/to/g, "");
                      const percentage = value * 100;
                      
                      return (
                        <div key={key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium capitalize">{label}</span>
                            <span className="text-sm text-muted-foreground">
                              {percentage.toFixed(1)}%
                            </span>
                          </div>
                          <Progress value={percentage} />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* REP PERFORMANCE DASHBOARD */}
        <TabsContent value="reps" className="space-y-6">
          <div className="flex items-center gap-2 flex-wrap" data-testid="role-filter-container">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mr-1">
              <Filter className="h-4 w-4" />
              <span>Roles:</span>
            </div>
            {rolesList.map((role) => (
              <Button
                key={role}
                size="sm"
                variant={selectedRoles.includes(role) ? "default" : "outline"}
                className="toggle-elevate"
                onClick={() => toggleRole(role)}
                data-testid={`role-filter-${role}`}
              >
                {role}
              </Button>
            ))}
          </div>

          {repLoading && (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground" data-testid="rep-loading">Loading performance data...</div>
              </CardContent>
            </Card>
          )}

          {!repLoading && selectedRoles.length === 0 && (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground" data-testid="rep-no-roles">
                  Select at least one role to view rep performance.
                </div>
              </CardContent>
            </Card>
          )}

          {repTimeseries && repTimeseries.repNames.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Revenue Won Over Time</CardTitle>
                <CardDescription>
                  Monthly closed-won revenue per rep
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={Object.fromEntries(
                    repTimeseries.repNames.map((name: string, i: number) => [
                      name,
                      {
                        label: name,
                        color: `hsl(${(i * 360) / Math.max(repTimeseries.repNames.length, 1)}, 70%, 50%)`,
                      },
                    ])
                  ) as ChartConfig}
                  className="aspect-[2/1] w-full"
                  data-testid="chart-rep-revenue-time"
                >
                  <AreaChart data={repTimeseries.timeseries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value: any, name: any) => [
                            formatCurrency(value as number),
                            name,
                          ]}
                        />
                      }
                    />
                    <Legend />
                    {repTimeseries.repNames.map((name: string, i: number) => (
                      <Area
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stackId="1"
                        stroke={`hsl(${(i * 360) / Math.max(repTimeseries.repNames.length, 1)}, 70%, 50%)`}
                        fill={`hsl(${(i * 360) / Math.max(repTimeseries.repNames.length, 1)}, 70%, 50%)`}
                        fillOpacity={0.3}
                      />
                    ))}
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {repPipelineStages && repPipelineStages.pipelineStages.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Open Pipeline by Stage</CardTitle>
                <CardDescription>
                  Each rep's open pipeline broken down by stage
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    prospecting: { label: "Prospecting", color: "hsl(220, 70%, 50%)" },
                    qualification: { label: "Qualification", color: "hsl(160, 70%, 45%)" },
                    proposal: { label: "Proposal", color: "hsl(40, 85%, 50%)" },
                    negotiation: { label: "Negotiation", color: "hsl(340, 70%, 50%)" },
                  }}
                  className="aspect-[2/1] w-full"
                  data-testid="chart-rep-pipeline-stages"
                >
                  <BarChart data={repPipelineStages.pipelineStages} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="repName" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value: any, name: any, item: any) => {
                            const stage = name as string;
                            const countKey = `${stage}_count`;
                            const count = item?.payload?.[countKey] ?? 0;
                            return [
                              `${formatCurrency(value as number)} (${count} deal${count !== 1 ? "s" : ""})`,
                              stage.charAt(0).toUpperCase() + stage.slice(1),
                            ];
                          }}
                        />
                      }
                    />
                    <Legend />
                    <Bar dataKey="prospecting" stackId="a" fill="hsl(220, 70%, 50%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="qualification" stackId="a" fill="hsl(160, 70%, 45%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="proposal" stackId="a" fill="hsl(40, 85%, 50%)" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="negotiation" stackId="a" fill="hsl(340, 70%, 50%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {!repLoading && hasRolesSelected && repPerformance && repPerformance.length > 0 && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Pipeline vs. Closed-Won Revenue</CardTitle>
                  <CardDescription>
                    Compare each rep's open pipeline value against their closed-won revenue
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      revenue: { label: "Closed-Won Revenue", color: "hsl(160, 70%, 45%)" },
                      pipelineValue: { label: "Open Pipeline", color: "hsl(220, 70%, 50%)" },
                    }}
                    className="aspect-[2/1] w-full"
                    data-testid="chart-rep-pipeline-vs-revenue"
                  >
                    <BarChart
                      data={repPerformance.filter((r: any) => r.revenue > 0 || r.pipelineValue > 0).slice(0, 10).map((r: any) => ({
                        name: r.rep.name,
                        revenue: r.revenue,
                        pipelineValue: r.pipelineValue,
                      }))}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value: any, name: any) => [
                              formatCurrency(value as number),
                              name === "revenue" ? "Closed-Won" : "Pipeline",
                            ]}
                          />
                        }
                      />
                      <Legend />
                      <Bar dataKey="revenue" fill="hsl(160, 70%, 45%)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pipelineValue" fill="hsl(220, 70%, 50%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rep Performance Rankings</CardTitle>
                  <CardDescription>
                    Based on revenue, win rate, and pipeline (Last 90 days)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {repPerformance.slice(0, 10).map((rep: any, idx: number) => (
                      <div key={rep.rep.id} className="flex items-center gap-4 p-4 border rounded-md hover-elevate" data-testid={`rep-row-${rep.rep.id}`}>
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted font-bold">
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium" data-testid={`text-rep-name-${rep.rep.id}`}>{rep.rep.name}</div>
                          <div className="text-sm text-muted-foreground">{rep.rep.email}</div>
                        </div>
                        <div className="text-right space-y-1">
                          <div className="font-bold" data-testid={`text-rep-revenue-${rep.rep.id}`}>{formatCurrency(rep.revenue)}</div>
                          <div className="text-sm text-muted-foreground">
                            {rep.dealsWon} won • {formatPercent(rep.winRate)} win rate
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">Pipeline</div>
                          <div className="text-sm text-muted-foreground" data-testid={`text-rep-pipeline-${rep.rep.id}`}>
                            {formatCurrency(rep.pipelineValue)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {!repLoading && hasRolesSelected && repPerformance && repPerformance.length === 0 && (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground" data-testid="rep-empty">
                  No reps found for the selected roles.
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
