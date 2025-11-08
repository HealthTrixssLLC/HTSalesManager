import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, DollarSign, Target, Zap, Users, AlertTriangle } from "lucide-react";
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

export default function AnalyticsPage() {
  // Fetch all analytics data
  const { data: forecast } = useQuery<any>({ queryKey: ["/api/analytics/forecast"] });
  const { data: historical } = useQuery<any>({ queryKey: ["/api/analytics/historical"] });
  const { data: velocity } = useQuery<any>({ queryKey: ["/api/analytics/velocity"] });
  const { data: conversions } = useQuery<any>({ queryKey: ["/api/analytics/conversions"] });
  const { data: predictions } = useQuery<any>({ queryKey: ["/api/analytics/predictions"] });
  const { data: repPerformance } = useQuery<any>({ queryKey: ["/api/analytics/rep-performance"] });
  const { data: pipelineHealth } = useQuery<any>({ queryKey: ["/api/analytics/pipeline-health"] });

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
        <h1 className="text-3xl font-bold mb-2" data-testid="text-analytics-title">Analytics & Forecasting</h1>
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
          {repPerformance && repPerformance.length > 0 && (
            <>
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
                      <div key={rep.rep.id} className="flex items-center gap-4 p-4 border rounded-lg hover-elevate">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted font-bold">
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{rep.rep.name}</div>
                          <div className="text-sm text-muted-foreground">{rep.rep.email}</div>
                        </div>
                        <div className="text-right space-y-1">
                          <div className="font-bold">{formatCurrency(rep.revenue)}</div>
                          <div className="text-sm text-muted-foreground">
                            {rep.dealsWon} won • {formatPercent(rep.winRate)} win rate
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">Pipeline</div>
                          <div className="text-sm text-muted-foreground">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
