// API Access Logs Tab Component
// Displays filtered, paginated API access logs with detailed metadata view and CSV export

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ChevronDown, ChevronRight, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiKey } from "@shared/schema";

interface ApiAccessLogsTabProps {
  apiKeys: ApiKey[] | undefined;
}

export function ApiAccessLogsTab({ apiKeys }: ApiAccessLogsTabProps) {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    apiKeyId: "",
    status: "",
    action: "",
  });
  const [page, setPage] = useState(0);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Build query params for the API call
  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.apiKeyId) params.append("apiKeyId", filters.apiKeyId);
    if (filters.status) params.append("status", filters.status);
    if (filters.action) params.append("action", filters.action);
    params.append("limit", "50");
    params.append("offset", String(page * 50));
    return `/api/admin/api-access-logs?${params.toString()}`;
  };

  // Fetch API access logs using default queryClient fetcher
  const { data: logsData, isLoading } = useQuery<{
    logs: any[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }>({
    queryKey: [buildQueryUrl()],
  });

  // Reset to first page when filters change
  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(0);
  };

  // Export logs to CSV
  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);
      if (filters.apiKeyId) params.append("apiKeyId", filters.apiKeyId);
      if (filters.status) params.append("status", filters.status);
      if (filters.action) params.append("action", filters.action);

      const res = await fetch(`/api/admin/api-access-logs/export?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `api-access-logs-${new Date().toISOString()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({ title: "Export successful", description: "CSV file downloaded" });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Format status badge
  const getStatusBadge = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return <Badge variant="default">Success</Badge>;
    if (statusCode === 401) return <Badge variant="destructive">Unauthorized</Badge>;
    if (statusCode === 404) return <Badge variant="secondary">Not Found</Badge>;
    if (statusCode === 429) return <Badge className="bg-orange-500">Rate Limited</Badge>;
    if (statusCode === 499) return <Badge variant="secondary">Client Abort</Badge>;
    if (statusCode >= 500) return <Badge variant="destructive">Server Error</Badge>;
    return <Badge variant="secondary">{statusCode}</Badge>;
  };

  // Format action type badge
  const getActionBadge = (action: string) => {
    if (action === "external_api_auth_success") return <Badge>Auth Success</Badge>;
    if (action === "external_api_auth_failure") return <Badge variant="destructive">Auth Failure</Badge>;
    if (action === "external_api_request_success") return <Badge>Request Success</Badge>;
    if (action === "external_api_request_failure") return <Badge variant="destructive">Request Failure</Badge>;
    return <Badge variant="secondary">{action}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                API Access Logs
              </CardTitle>
              <CardDescription>View and export detailed API call logs for debugging</CardDescription>
            </div>
            <Button onClick={handleExportCSV} data-testid="button-export-logs">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
                data-testid="input-start-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
                data-testid="input-end-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-filter">API Key</Label>
              <Select
                value={filters.apiKeyId}
                onValueChange={(value) => handleFilterChange("apiKeyId", value)}
              >
                <SelectTrigger id="api-key-filter" data-testid="select-api-key">
                  <SelectValue placeholder="All API Keys" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All API Keys</SelectItem>
                  {apiKeys?.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-filter">Status Code</Label>
              <Select
                value={filters.status}
                onValueChange={(value) => handleFilterChange("status", value)}
              >
                <SelectTrigger id="status-filter" data-testid="select-status">
                  <SelectValue placeholder="All Status Codes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Status Codes</SelectItem>
                  <SelectItem value="200">200 - Success</SelectItem>
                  <SelectItem value="401">401 - Unauthorized</SelectItem>
                  <SelectItem value="404">404 - Not Found</SelectItem>
                  <SelectItem value="429">429 - Rate Limited</SelectItem>
                  <SelectItem value="499">499 - Client Abort</SelectItem>
                  <SelectItem value="500">500 - Server Error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-filter">Action Type</Label>
              <Select
                value={filters.action}
                onValueChange={(value) => handleFilterChange("action", value)}
              >
                <SelectTrigger id="action-filter" data-testid="select-action">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Actions</SelectItem>
                  <SelectItem value="external_api_auth_success">Auth Success</SelectItem>
                  <SelectItem value="external_api_auth_failure">Auth Failure</SelectItem>
                  <SelectItem value="external_api_request_success">Request Success</SelectItem>
                  <SelectItem value="external_api_request_failure">Request Failure</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Logs Table */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Loading logs...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !logsData?.logs?.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2 py-8">
                        <AlertCircle className="h-8 w-8 text-muted-foreground" />
                        <p>No API access logs found for the selected filters</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {logsData?.logs?.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const metadata = log.after || {};
                  
                  return (
                    <>
                      <TableRow 
                        key={log.id}
                        className="hover-elevate cursor-pointer"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        data-testid={`row-log-${log.id}`}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>{getActionBadge(log.action)}</TableCell>
                        <TableCell className="font-mono text-sm">{metadata.endpoint || "—"}</TableCell>
                        <TableCell>{getStatusBadge(metadata.statusCode || 0)}</TableCell>
                        <TableCell className="text-sm">{metadata.apiKeyName || "—"}</TableCell>
                        <TableCell className="text-sm font-mono">{log.ipAddress || "—"}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/50 p-4">
                            <div className="space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-sm font-medium mb-1">Request Details</p>
                                  <div className="space-y-1 text-sm">
                                    <div><span className="text-muted-foreground">Method:</span> {metadata.method || "—"}</div>
                                    <div><span className="text-muted-foreground">Endpoint:</span> {metadata.endpoint || "—"}</div>
                                    <div><span className="text-muted-foreground">Query:</span> {metadata.query || "—"}</div>
                                    <div><span className="text-muted-foreground">User Agent:</span> {log.userAgent || "—"}</div>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-sm font-medium mb-1">Response Details</p>
                                  <div className="space-y-1 text-sm">
                                    <div><span className="text-muted-foreground">Status:</span> {metadata.statusCode || "—"}</div>
                                    <div><span className="text-muted-foreground">Latency:</span> {metadata.latency ? `${metadata.latency}ms` : "—"}</div>
                                    <div><span className="text-muted-foreground">Response Size:</span> {metadata.responseSize ? `${Math.round(metadata.responseSize / 1024)}KB` : "—"}</div>
                                    <div><span className="text-muted-foreground">Aborted:</span> {metadata.aborted ? "Yes" : "No"}</div>
                                  </div>
                                </div>
                              </div>
                              {metadata.errorType && (
                                <div>
                                  <p className="text-sm font-medium mb-1 text-destructive">Error Details</p>
                                  <div className="space-y-1 text-sm">
                                    <div><span className="text-muted-foreground">Type:</span> {metadata.errorType}</div>
                                    <div><span className="text-muted-foreground">Code:</span> {metadata.errorCode || "—"}</div>
                                    <div><span className="text-muted-foreground">Message:</span> {metadata.errorMessage || "—"}</div>
                                    {metadata.resourceId && (
                                      <div><span className="text-muted-foreground">Resource ID:</span> {metadata.resourceId}</div>
                                    )}
                                    {metadata.resourceType && (
                                      <div><span className="text-muted-foreground">Resource Type:</span> {metadata.resourceType}</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {logsData && logsData.pagination.total > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {logsData.pagination.offset + 1}-
                {Math.min(logsData.pagination.offset + logsData.pagination.limit, logsData.pagination.total)} of{" "}
                {logsData.pagination.total} logs
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 0}
                  data-testid="button-prev-page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={!logsData.pagination.hasMore}
                  data-testid="button-next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
