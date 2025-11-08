// Audit Log page with detailed activity tracking
// Based on design_guidelines.md enterprise SaaS patterns

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, History, ChevronDown, ChevronRight } from "lucide-react";
import { AuditLog } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const actionColors: Record<string, string> = {
  create: "bg-green-500",
  update: "bg-blue-500",
  delete: "bg-red-500",
  convert: "bg-purple-500",
};

export default function AuditLogPage() {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: auditLogs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs"],
  });

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const formatDiff = (before: any, after: any) => {
    if (!before && after) {
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-green-600">Created:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      );
    }
    if (before && !after) {
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium text-red-600">Deleted:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
            {JSON.stringify(before, null, 2)}
          </pre>
        </div>
      );
    }
    if (before && after) {
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Before:</p>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(before, null, 2)}
            </pre>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-primary">After:</p>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(after, null, 2)}
            </pre>
          </div>
        </div>
      );
    }
    return null;
  };

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
        <h1 className="text-3xl font-semibold text-foreground">Audit Log</h1>
        <p className="text-muted-foreground">Complete audit trail of all system changes</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Activity Log ({auditLogs?.length || 0} entries)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditLogs && auditLogs.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Resource ID</TableHead>
                  <TableHead>IP Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => {
                  const isExpanded = expandedRows.has(log.id);
                  return (
                    <>
                      <TableRow key={log.id} data-testid={`row-audit-${log.id}`}>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleRow(log.id)}
                            data-testid={`button-expand-${log.id}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm">{log.actorId || "System"}</TableCell>
                        <TableCell>
                          <Badge className={actionColors[log.action] || "bg-gray-500"}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{log.resource}</TableCell>
                        <TableCell className="font-mono text-xs">{log.resourceId || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.ipAddress || "-"}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="p-4">
                              <h4 className="font-medium mb-3">Change Details</h4>
                              {formatDiff(log.before, log.after)}
                              {log.userAgent && (
                                <div className="mt-3">
                                  <p className="text-xs text-muted-foreground">
                                    User Agent: {log.userAgent}
                                  </p>
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
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No audit log entries found.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
