import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Filter, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocation } from "wouter";

type ResourceAllocationData = {
  opportunities: Array<{
    id: string;
    name: string;
    stage: string;
    accountName: string | null;
    implementationStartDate: string | null;
    implementationEndDate: string | null;
    effectiveStartDate: string | null;
    effectiveEndDate: string | null;
    closeDate: string | null;
    amount: string | null;
    resources: Array<{
      id: string;
      userId: string;
      role: string;
      userName: string;
    }>;
  }>;
  users: Array<{
    id: string;
    name: string;
    assignments: Array<{
      resourceId: string;
      role: string;
      opportunityId: string;
      opportunityName: string;
      stage: string;
      implementationStartDate: string | null;
      implementationEndDate: string | null;
      effectiveStartDate: string | null;
      effectiveEndDate: string | null;
    }>;
  }>;
};

const stageColors: Record<string, string> = {
  prospecting: "bg-slate-400",
  qualification: "bg-blue-400",
  proposal: "bg-amber-400",
  negotiation: "bg-orange-400",
  closed_won: "bg-emerald-400",
  closed_lost: "bg-red-400",
};

const stageLabels: Record<string, string> = {
  prospecting: "Prospecting",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

function getMonthsBetween(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  while (current <= end) {
    months.push(new Date(current));
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function getBarPosition(
  startDate: Date,
  endDate: Date,
  timelineStart: Date,
  timelineEnd: Date,
  totalWidth: number
): { left: number; width: number } | null {
  const totalMs = timelineEnd.getTime() - timelineStart.getTime();
  if (totalMs <= 0) return null;

  const barStart = Math.max(startDate.getTime(), timelineStart.getTime());
  const barEnd = Math.min(endDate.getTime(), timelineEnd.getTime());

  if (barStart >= barEnd) return null;

  const left = ((barStart - timelineStart.getTime()) / totalMs) * totalWidth;
  const width = ((barEnd - barStart) / totalMs) * totalWidth;

  return { left: Math.max(0, left), width: Math.max(8, width) };
}

export default function ResourceAllocationPage() {
  const [, setLocation] = useLocation();
  const [showFilters, setShowFilters] = useState(false);
  const [filterUser, setFilterUser] = useState<string>("all");
  const [filterStage, setFilterStage] = useState<string>("all");

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 6, 0);

  const [dateRangeStart, setDateRangeStart] = useState<string>(defaultStart.toISOString().split("T")[0]);
  const [dateRangeEnd, setDateRangeEnd] = useState<string>(defaultEnd.toISOString().split("T")[0]);

  const { data, isLoading } = useQuery<ResourceAllocationData>({
    queryKey: ["/api/resource-allocation"],
  });

  const timelineStart = useMemo(() => new Date(dateRangeStart), [dateRangeStart]);
  const timelineEnd = useMemo(() => new Date(dateRangeEnd), [dateRangeEnd]);
  const months = useMemo(() => getMonthsBetween(timelineStart, timelineEnd), [timelineStart, timelineEnd]);

  const filteredOpportunities = useMemo(() => {
    if (!data) return [];
    return data.opportunities.filter(opp => {
      const start = opp.effectiveStartDate || opp.implementationStartDate;
      const end = opp.effectiveEndDate || opp.implementationEndDate;
      if (!start || !end) return false;
      if (filterStage !== "all" && opp.stage !== filterStage) return false;
      if (filterUser !== "all") {
        if (!opp.resources.some(r => r.userId === filterUser)) return false;
      }
      const oppStart = new Date(start);
      const oppEnd = new Date(end);
      return oppEnd >= timelineStart && oppStart <= timelineEnd;
    });
  }, [data, filterStage, filterUser, timelineStart, timelineEnd]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    return data.users
      .filter(u => {
        if (filterUser !== "all" && u.id !== filterUser) return false;
        return u.assignments.some(a => {
          const start = a.effectiveStartDate || a.implementationStartDate;
          const end = a.effectiveEndDate || a.implementationEndDate;
          if (!start || !end) return false;
          if (filterStage !== "all" && a.stage !== filterStage) return false;
          const aStart = new Date(start);
          const aEnd = new Date(end);
          return aEnd >= timelineStart && aStart <= timelineEnd;
        });
      })
      .map(u => ({
        ...u,
        assignments: u.assignments.filter(a => {
          const start = a.effectiveStartDate || a.implementationStartDate;
          const end = a.effectiveEndDate || a.implementationEndDate;
          if (!start || !end) return false;
          if (filterStage !== "all" && a.stage !== filterStage) return false;
          const aStart = new Date(start);
          const aEnd = new Date(end);
          return aEnd >= timelineStart && aStart <= timelineEnd;
        }),
      }));
  }, [data, filterUser, filterStage, timelineStart, timelineEnd]);

  const allUsersForFilter = useMemo(() => {
    if (!data) return [];
    return data.users.map(u => ({ id: u.id, name: u.name }));
  }, [data]);

  const shiftTimeline = (direction: "prev" | "next") => {
    const months = direction === "next" ? 3 : -3;
    const newStart = new Date(timelineStart);
    const newEnd = new Date(timelineEnd);
    newStart.setMonth(newStart.getMonth() + months);
    newEnd.setMonth(newEnd.getMonth() + months);
    setDateRangeStart(newStart.toISOString().split("T")[0]);
    setDateRangeEnd(newEnd.toISOString().split("T")[0]);
  };

  const TIMELINE_WIDTH = 900;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="resource-allocation-page">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Resource Allocation</h1>
          <p className="text-muted-foreground">Pipeline and resource timelines for implementation planning</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => shiftTimeline("prev")} data-testid="button-timeline-prev">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Earlier
          </Button>
          <Button variant="outline" onClick={() => shiftTimeline("next")} data-testid="button-timeline-next">
            Later
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)} data-testid="button-toggle-filters">
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card data-testid="filter-panel">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Start Date</label>
                <Input
                  type="date"
                  value={dateRangeStart}
                  onChange={e => setDateRangeStart(e.target.value)}
                  data-testid="input-date-start"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">End Date</label>
                <Input
                  type="date"
                  value={dateRangeEnd}
                  onChange={e => setDateRangeEnd(e.target.value)}
                  data-testid="input-date-end"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Resource</label>
                <Select value={filterUser} onValueChange={setFilterUser}>
                  <SelectTrigger data-testid="select-filter-user">
                    <SelectValue placeholder="All resources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Resources</SelectItem>
                    {allUsersForFilter.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1 block">Stage</label>
                <Select value={filterStage} onValueChange={setFilterStage}>
                  <SelectTrigger data-testid="select-filter-stage">
                    <SelectValue placeholder="All stages" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    {Object.entries(stageLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterUser("all");
                  setFilterStage("all");
                  setDateRangeStart(defaultStart.toISOString().split("T")[0]);
                  setDateRangeEnd(defaultEnd.toISOString().split("T")[0]);
                }}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-1" /> Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="pipeline-timeline">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-lg">Pipeline Timeline</CardTitle>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(stageLabels).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1">
                <div className={`h-3 w-3 rounded-sm ${stageColors[key]}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {filteredOpportunities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-pipeline-data">
              No opportunities with implementation dates in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: TIMELINE_WIDTH + 220 }}>
                <div className="flex border-b pb-1 mb-2">
                  <div className="w-[220px] shrink-0 text-xs font-medium text-muted-foreground pr-2">Opportunity</div>
                  <div className="flex-1 flex relative" style={{ width: TIMELINE_WIDTH }}>
                    {months.map((m, i) => (
                      <div
                        key={i}
                        className="text-xs text-muted-foreground text-center border-l border-border/40"
                        style={{ width: `${100 / months.length}%` }}
                      >
                        {formatMonthLabel(m)}
                      </div>
                    ))}
                  </div>
                </div>

                {filteredOpportunities.map(opp => {
                  const startDate = new Date((opp.effectiveStartDate || opp.implementationStartDate)!);
                  const endDate = new Date((opp.effectiveEndDate || opp.implementationEndDate)!);
                  const bar = getBarPosition(startDate, endDate, timelineStart, timelineEnd, TIMELINE_WIDTH);

                  return (
                    <div key={opp.id} className="flex items-center mb-1.5 group">
                      <div className="w-[220px] shrink-0 pr-2">
                        <button
                          className="text-xs font-medium text-left truncate w-full hover:text-primary transition-colors"
                          onClick={() => setLocation(`/opportunities/${opp.id}`)}
                          data-testid={`link-pipeline-opp-${opp.id}`}
                        >
                          {opp.name}
                        </button>
                        {opp.accountName && (
                          <p className="text-[10px] text-muted-foreground truncate">{opp.accountName}</p>
                        )}
                      </div>
                      <div className="flex-1 relative h-7" style={{ width: TIMELINE_WIDTH }}>
                        {months.map((_, i) => (
                          <div
                            key={i}
                            className="absolute top-0 bottom-0 border-l border-border/20"
                            style={{ left: `${(i / months.length) * 100}%` }}
                          />
                        ))}
                        {bar && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={`absolute top-1 h-5 rounded-sm ${stageColors[opp.stage] || "bg-muted"} opacity-85 hover:opacity-100 transition-opacity cursor-pointer`}
                                style={{ left: bar.left, width: bar.width }}
                                data-testid={`bar-pipeline-opp-${opp.id}`}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <div className="text-xs space-y-0.5">
                                <p className="font-medium">{opp.name}</p>
                                <p>{stageLabels[opp.stage] || opp.stage}</p>
                                <p>{startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}</p>
                                {opp.resources.length > 0 && (
                                  <p>{opp.resources.map(r => r.userName).join(", ")}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="resource-timeline">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Resource Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-no-resource-data">
              No resource assignments with implementation dates in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: TIMELINE_WIDTH + 220 }}>
                <div className="flex border-b pb-1 mb-2">
                  <div className="w-[220px] shrink-0 text-xs font-medium text-muted-foreground pr-2">Resource</div>
                  <div className="flex-1 flex relative" style={{ width: TIMELINE_WIDTH }}>
                    {months.map((m, i) => (
                      <div
                        key={i}
                        className="text-xs text-muted-foreground text-center border-l border-border/40"
                        style={{ width: `${100 / months.length}%` }}
                      >
                        {formatMonthLabel(m)}
                      </div>
                    ))}
                  </div>
                </div>

                {filteredUsers.map(user => (
                  <div key={user.id} className="mb-3" data-testid={`resource-row-${user.id}`}>
                    <div className="flex items-center mb-1">
                      <div className="w-[220px] shrink-0 pr-2 flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px]">{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{user.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.assignments.length} assignment{user.assignments.length !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                    </div>

                    {user.assignments.map(assignment => {
                      const startDate = new Date((assignment.effectiveStartDate || assignment.implementationStartDate)!);
                      const endDate = new Date((assignment.effectiveEndDate || assignment.implementationEndDate)!);
                      const bar = getBarPosition(startDate, endDate, timelineStart, timelineEnd, TIMELINE_WIDTH);

                      return (
                        <div key={assignment.resourceId} className="flex items-center mb-0.5">
                          <div className="w-[220px] shrink-0 pr-2 pl-8">
                            <button
                              className="text-[11px] text-muted-foreground truncate w-full text-left hover:text-primary transition-colors"
                              onClick={() => setLocation(`/opportunities/${assignment.opportunityId}`)}
                              data-testid={`link-resource-opp-${assignment.opportunityId}`}
                            >
                              {assignment.opportunityName}
                              <span className="ml-1 text-[10px]">({assignment.role})</span>
                            </button>
                          </div>
                          <div className="flex-1 relative h-5" style={{ width: TIMELINE_WIDTH }}>
                            {months.map((_, i) => (
                              <div
                                key={i}
                                className="absolute top-0 bottom-0 border-l border-border/20"
                                style={{ left: `${(i / months.length) * 100}%` }}
                              />
                            ))}
                            {bar && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={`absolute top-0.5 h-4 rounded-sm ${stageColors[assignment.stage] || "bg-muted"} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                                    style={{ left: bar.left, width: bar.width }}
                                    data-testid={`bar-resource-${assignment.resourceId}`}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="text-xs space-y-0.5">
                                    <p className="font-medium">{assignment.opportunityName}</p>
                                    <p>Role: {assignment.role}</p>
                                    <p>{startDate.toLocaleDateString()} - {endDate.toLocaleDateString()}</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
