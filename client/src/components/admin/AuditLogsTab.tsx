import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLogEntry[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

const RESOURCE_OPTIONS = [
  "User",
  "Account",
  "Lead",
  "Contact",
  "Opportunity",
  "Activity",
  "Role",
  "ApiKey",
  "Organization",
];

const ACTION_OPTIONS = [
  "create",
  "update",
  "delete",
  "merge",
  "convert",
  "restore",
  "reset",
  "deactivate",
  "reactivate",
  "revoke",
];

function getActionBadgeClass(action: string): string {
  switch (action) {
    case "create":
      return "bg-green-600 dark:bg-green-700 text-white border-transparent";
    case "delete":
    case "reset":
      return "bg-destructive text-destructive-foreground border-transparent";
    case "merge":
      return "bg-violet-600 dark:bg-violet-700 text-white border-transparent";
    case "update":
      return "bg-blue-600 dark:bg-blue-700 text-white border-transparent";
    case "convert":
      return "bg-amber-500 dark:bg-amber-600 text-white border-transparent";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function JsonPreview({ value, label }: { value: unknown; label: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground text-xs italic">none</span>;
  }
  return (
    <pre className="text-xs bg-muted rounded-md p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditLogsTab() {
  const [filters, setFilters] = useState({ resource: "", action: "" });
  const [page, setPage] = useState(0);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.resource) params.append("resource", filters.resource);
    if (filters.action) params.append("action", filters.action);
    params.append("limit", String(PAGE_SIZE));
    params.append("offset", String(page * PAGE_SIZE));
    return `/api/admin/audit-logs?${params.toString()}`;
  };

  const { data, isLoading, isError } = useQuery<AuditLogsResponse>({
    queryKey: ["/api/admin/audit-logs", filters.resource, filters.action, page],
    queryFn: async () => {
      const res = await fetch(buildQueryUrl(), { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed: ${res.status}`);
      }
      return res.json();
    },
  });

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination ? Math.ceil(pagination.total / PAGE_SIZE) : 0;

  const handleFilterChange = (key: "resource" | "action", value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value === "__all__" ? "" : value }));
    setPage(0);
    setExpandedLogId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit Logs</CardTitle>
        <CardDescription>Review admin actions such as merges, deletions, and role changes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label>Resource Type</Label>
            <Select
              value={filters.resource || "__all__"}
              onValueChange={(v) => handleFilterChange("resource", v)}
            >
              <SelectTrigger className="w-44" data-testid="select-audit-resource">
                <SelectValue placeholder="All resources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All resources</SelectItem>
                {RESOURCE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Action</Label>
            <Select
              value={filters.action || "__all__"}
              onValueChange={(v) => handleFilterChange("action", v)}
            >
              <SelectTrigger className="w-44" data-testid="select-audit-action">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All actions</SelectItem>
                {ACTION_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isError && (
          <div className="flex items-center gap-2 text-destructive text-sm py-2" data-testid="audit-logs-error">
            <AlertCircle className="h-4 w-4" />
            Failed to load audit logs.
          </div>
        )}

        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground text-sm" data-testid="audit-logs-loading">
            Loading audit logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm" data-testid="audit-logs-empty">
            No audit log entries found.
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Resource ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <TableRow
                        className="cursor-pointer hover-elevate"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        data-testid={`audit-log-row-${log.id}`}
                      >
                        <TableCell className="pr-0">
                          {isExpanded
                            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap" data-testid={`audit-log-timestamp-${log.id}`}>
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`audit-log-actor-${log.id}`}>
                          {log.actorName ?? log.actorEmail ?? log.actorId ?? (
                            <span className="text-muted-foreground italic">System</span>
                          )}
                        </TableCell>
                        <TableCell data-testid={`audit-log-action-${log.id}`}>
                          <Badge className={getActionBadgeClass(log.action)}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`audit-log-resource-${log.id}`}>
                          {log.resource}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono" data-testid={`audit-log-resource-id-${log.id}`}>
                          {log.resourceId ?? "—"}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${log.id}-expanded`} data-testid={`audit-log-expanded-${log.id}`}>
                          <TableCell colSpan={6} className="bg-muted/30 p-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Before</p>
                                <JsonPreview value={log.before} label="before" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">After</p>
                                <JsonPreview value={log.after} label="after" />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 pt-2" data-testid="audit-logs-pagination">
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
              {pagination && ` (${pagination.total} total)`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                data-testid="button-audit-logs-prev"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination?.hasMore}
                onClick={() => setPage((p) => p + 1)}
                data-testid="button-audit-logs-next"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
