// Admin Console with user/role management, ID patterns, and system operations
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Save, Database, Download, Upload, AlertTriangle } from "lucide-react";
import { User, Role, IdPattern } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function AdminConsole() {
  const { toast } = useToast();
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<IdPattern | null>(null);
  const [patternPreview, setPatternPreview] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/admin/users"] });
  const { data: roles } = useQuery<Role[]>({ queryKey: ["/api/admin/roles"] });
  const { data: idPatterns } = useQuery<IdPattern[]>({ queryKey: ["/api/admin/id-patterns"] });

  const updatePatternMutation = useMutation({
    mutationFn: async (data: { id: string; pattern: string; startValue?: number }) => {
      const res = await apiRequest("PATCH", `/api/admin/id-patterns/${data.id}`, { 
        pattern: data.pattern,
        startValue: data.startValue
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/id-patterns"] });
      toast({ title: "ID pattern updated successfully" });
      setSelectedPattern(null);
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/backup", {
        method: "POST",
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error("Failed to create backup");
      }
      
      // Get the file data and checksum
      const blob = await res.blob();
      const checksum = res.headers.get("X-Backup-Checksum");
      
      // Trigger download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `healthtrixss-backup-${Date.now()}.htb`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      return { checksum };
    },
    onSuccess: () => {
      toast({ title: "Backup downloaded successfully" });
    },
    onError: () => {
      toast({ 
        title: "Backup failed", 
        description: "Failed to create backup file",
        variant: "destructive" 
      });
    },
  });

  const restoreBackupMutation = useMutation({
    mutationFn: async (file: File) => {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      
      // Checksum is embedded in the file, no need to send separately
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/octet-stream",
        },
        body: buffer,
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Restore failed");
      }
      
      return await res.json();
    },
    onSuccess: (data) => {
      toast({ 
        title: "Restore completed successfully",
        description: `Restored ${data.recordsRestored} records`,
      });
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      toast({ 
        title: "Restore failed", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const resetDatabaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/reset-database", {});
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Database reset successfully" });
      queryClient.invalidateQueries();
      setConfirmResetOpen(false);
    },
  });
  
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      restoreBackupMutation.mutate(file);
    }
  };

  const generatePreview = (pattern: string) => {
    const now = new Date();
    const preview = pattern
      .replace("{PREFIX}", "ACCT")
      .replace("{YYYY}", now.getFullYear().toString())
      .replace("{YY}", now.getFullYear().toString().slice(2))
      .replace("{MM}", (now.getMonth() + 1).toString().padStart(2, "0"))
      .replace(/{SEQ:(\d+)}/g, (_, len) => "1".padStart(parseInt(len), "0"));
    return preview;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-foreground">Admin Console</h1>
        <p className="text-muted-foreground">System administration and configuration</p>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="roles" data-testid="tab-roles">Roles</TabsTrigger>
          <TabsTrigger value="id-patterns" data-testid="tab-id-patterns">ID Patterns</TabsTrigger>
          <TabsTrigger value="backup" data-testid="tab-backup">Backup & Restore</TabsTrigger>
          <TabsTrigger value="system" data-testid="tab-system">System</TabsTrigger>
        </TabsList>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>Manage user accounts and access</CardDescription>
                </div>
                <Button data-testid="button-create-user">
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={user.status === "active" ? "default" : "secondary"}>
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Roles Tab */}
        <TabsContent value="roles" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Role Management</CardTitle>
                  <CardDescription>Configure roles and permissions</CardDescription>
                </div>
                <Button data-testid="button-create-role">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Role
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles?.map((role) => (
                    <TableRow key={role.id} data-testid={`row-role-${role.id}`}>
                      <TableCell className="font-medium">{role.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{role.description || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(role.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ID Patterns Tab */}
        <TabsContent value="id-patterns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ID Pattern Configuration</CardTitle>
              <CardDescription>Configure automatic ID generation patterns for entities</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {idPatterns?.map((pattern) => (
                  <Card key={pattern.id} className="p-4" data-testid={`card-pattern-${pattern.entity}`}>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <h4 className="font-medium">{pattern.entity}</h4>
                        <p className="text-sm font-mono text-muted-foreground">{pattern.pattern}</p>
                        <p className="text-xs text-muted-foreground">
                          Preview: <span className="font-mono">{generatePreview(pattern.pattern)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Counter: {pattern.counter} | Start: {pattern.startValue || 1} | Last Issued: {pattern.lastIssued || "None"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedPattern(pattern)}
                        data-testid={`button-edit-pattern-${pattern.entity}`}
                      >
                        Edit
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="p-4 bg-muted/30">
                <h4 className="font-medium mb-2">Available Tokens</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><code className="bg-background px-1.5 py-0.5 rounded">{"{PREFIX}"}</code> - Entity prefix</div>
                  <div><code className="bg-background px-1.5 py-0.5 rounded">{"{YYYY}"}</code> - 4-digit year</div>
                  <div><code className="bg-background px-1.5 py-0.5 rounded">{"{YY}"}</code> - 2-digit year</div>
                  <div><code className="bg-background px-1.5 py-0.5 rounded">{"{MM}"}</code> - 2-digit month</div>
                  <div><code className="bg-background px-1.5 py-0.5 rounded">{"{SEQ:n}"}</code> - n-digit sequence (starts from custom value)</div>
                </div>
              </Card>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Backup & Restore Tab */}
        <TabsContent value="backup" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  Create Backup
                </CardTitle>
                <CardDescription>Export complete database snapshot</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => createBackupMutation.mutate()}
                  disabled={createBackupMutation.isPending}
                  data-testid="button-create-backup"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {createBackupMutation.isPending ? "Creating..." : "Create Backup"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Restore Backup
                </CardTitle>
                <CardDescription>Import database from backup file</CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".htb"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                  data-testid="input-restore-file"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={restoreBackupMutation.isPending}
                  data-testid="button-restore-backup"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {restoreBackupMutation.isPending ? "Restoring..." : "Restore from Backup"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system" className="space-y-4">
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Danger Zone
              </CardTitle>
              <CardDescription>Irreversible system operations - proceed with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Reset Database</Label>
                <p className="text-sm text-muted-foreground">
                  Delete all data and reset the database to initial state. This action cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmResetOpen(true)}
                  data-testid="button-reset-database"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Reset Database
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit ID Pattern Dialog */}
      {selectedPattern && (
        <Dialog open={!!selectedPattern} onOpenChange={() => setSelectedPattern(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit ID Pattern: {selectedPattern.entity}</DialogTitle>
              <DialogDescription>Configure the automatic ID generation pattern</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Pattern</Label>
                <Input
                  value={selectedPattern.pattern}
                  onChange={(e) => {
                    setSelectedPattern({ ...selectedPattern, pattern: e.target.value });
                    setPatternPreview(generatePreview(e.target.value));
                  }}
                  className="font-mono"
                  data-testid="input-pattern"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Preview: <span className="font-mono">{patternPreview || generatePreview(selectedPattern.pattern)}</span>
                </p>
              </div>
              <div>
                <Label>Starting Value</Label>
                <Input
                  type="number"
                  value={selectedPattern.startValue || 1}
                  onChange={(e) => {
                    setSelectedPattern({ ...selectedPattern, startValue: parseInt(e.target.value) || 1 });
                  }}
                  min="1"
                  data-testid="input-start-value"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The sequence will start from this number (e.g., 1000 for ACCT-2025-01000)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedPattern(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => updatePatternMutation.mutate({ 
                  id: selectedPattern.id, 
                  pattern: selectedPattern.pattern,
                  startValue: selectedPattern.startValue || undefined
                })}
                disabled={updatePatternMutation.isPending}
                data-testid="button-save-pattern"
              >
                <Save className="h-4 w-4 mr-2" />
                {updatePatternMutation.isPending ? "Saving..." : "Save Pattern"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Confirm Reset Dialog */}
      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all data including accounts, contacts, leads, opportunities, and activities.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetDatabaseMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-reset"
            >
              Yes, reset database
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
