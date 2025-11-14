// Admin Console with user/role management, ID patterns, and system operations
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Save, Database, Download, Upload, AlertTriangle, Edit2, X, Check, Key, Copy, Calendar } from "lucide-react";
import { User, Role, IdPattern, AccountCategory, InsertAccountCategory, ApiKey } from "@shared/schema";
import { ApiAccessLogsTab } from "@/components/ApiAccessLogsTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type UserWithRoles = User & { roles: Role[] };

export default function AdminConsole() {
  const { toast } = useToast();
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmClearAccountsOpen, setConfirmClearAccountsOpen] = useState(false);
  const [confirmSystemResetOpen, setConfirmSystemResetOpen] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<IdPattern | null>(null);
  const [patternPreview, setPatternPreview] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserData, setEditUserData] = useState<{name: string; email: string; roleId: string}>({name: "", email: "", roleId: ""});
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserData, setNewUserData] = useState<{name: string; email: string; password: string; roleId: string}>({
    name: "", email: "", password: "", roleId: ""
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dynamicsEntityType, setDynamicsEntityType] = useState<"accounts" | "contacts" | "leads" | "opportunities" | "activities">("accounts");
  const [dynamicsExcelFile, setDynamicsExcelFile] = useState<File | null>(null);
  const [dynamicsMapping, setDynamicsMapping] = useState<File | null>(null);
  const [dynamicsTemplate, setDynamicsTemplate] = useState<File | null>(null);
  const [transforming, setTransforming] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryData, setEditCategoryData] = useState<{name: string; description: string; isActive: boolean}>({name: "", description: "", isActive: true});
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [newCategoryData, setNewCategoryData] = useState<{name: string; description: string; isActive: boolean}>({
    name: "", description: "", isActive: true
  });
  const [categoryToDelete, setCategoryToDelete] = useState<AccountCategory | null>(null);
  const [createApiKeyOpen, setCreateApiKeyOpen] = useState(false);
  const [newApiKeyData, setNewApiKeyData] = useState<{name: string; description: string; expiresAt: string}>({
    name: "", description: "", expiresAt: ""
  });
  const [generatedApiKey, setGeneratedApiKey] = useState<{key: string; name: string} | null>(null);
  const [revokeApiKeyId, setRevokeApiKeyId] = useState<string | null>(null);

  const { data: users } = useQuery<UserWithRoles[]>({ queryKey: ["/api/admin/users"] });
  const { data: roles } = useQuery<Role[]>({ queryKey: ["/api/admin/roles"] });
  const { data: idPatterns } = useQuery<IdPattern[]>({ queryKey: ["/api/admin/id-patterns"] });
  const { data: categories } = useQuery<AccountCategory[]>({ queryKey: ["/api/admin/categories"] });
  const { data: apiKeys } = useQuery<ApiKey[]>({ queryKey: ["/api/admin/api-keys"] });
  
  // Fetch database diagnostics when activities entity type is selected
  const { data: dbDiagnostics } = useQuery({
    queryKey: ["/api/admin/diagnostics/database"],
    enabled: dynamicsEntityType === "activities", // Only fetch when activities is selected
    staleTime: 30000, // Cache for 30 seconds
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; roleId: string }) => {
      const res = await apiRequest("POST", "/api/admin/users", {
        name: data.name,
        email: data.email,
        password: data.password,
        roleId: data.roleId
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User created successfully" });
      setCreateUserOpen(false);
      setNewUserData({ name: "", email: "", password: "", roleId: "" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create user",
        description: error.message,
        variant: "destructive" 
      });
    },
  });
  
  const updateUserMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; email: string; roleId: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${data.id}`, {
        name: data.name,
        email: data.email,
        roleId: data.roleId
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated successfully" });
      setEditingUserId(null);
    },
    onError: () => {
      toast({ 
        title: "Failed to update user", 
        variant: "destructive" 
      });
    },
  });
  
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
        // Include detailed error information
        const errorMessage = error.details 
          ? `${error.error}: ${Array.isArray(error.details) ? error.details.join(', ') : error.details}`
          : error.error || "Restore failed";
        throw new Error(errorMessage);
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

  const clearAccountsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/clear-accounts", {});
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "All accounts cleared successfully" });
      queryClient.invalidateQueries();
      setConfirmClearAccountsOpen(false);
    },
  });

  const systemResetMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/system-reset", {});
      return await res.json();
    },
    onSuccess: () => {
      toast({ 
        title: "System reset successfully",
        description: "All users deleted. Next registration will become Admin." 
      });
      setConfirmSystemResetOpen(false);
      // Redirect to auth page after a short delay since the user will be logged out
      setTimeout(() => {
        window.location.href = "/auth";
      }, 2000);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to reset system",
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: InsertAccountCategory) => {
      const res = await apiRequest("POST", "/api/admin/categories", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: "Category created successfully" });
      setCreateCategoryOpen(false);
      setNewCategoryData({ name: "", description: "", isActive: true });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create category",
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description?: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/categories/${data.id}`, {
        name: data.name,
        description: data.description,
        isActive: data.isActive
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: "Category updated successfully" });
      setEditingCategoryId(null);
    },
    onError: () => {
      toast({ 
        title: "Failed to update category", 
        variant: "destructive" 
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/categories/${id}`, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: "Category deleted successfully" });
      setCategoryToDelete(null);
    },
    onError: () => {
      toast({ 
        title: "Failed to delete category", 
        variant: "destructive" 
      });
    },
  });

  const createApiKeyMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; expiresAt?: string }) => {
      const res = await apiRequest("POST", "/api/admin/api-keys", {
        name: data.name,
        description: data.description || null,
        expiresAt: data.expiresAt || null,
        isActive: true,
        rateLimitPerMin: 100, // Default rate limit
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setGeneratedApiKey({ key: data.apiKey, name: data.name });
      setCreateApiKeyOpen(false);
      setNewApiKeyData({ name: "", description: "", expiresAt: "" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create API key",
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/api-keys/${id}`, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({ title: "API key revoked successfully" });
      setRevokeApiKeyId(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to revoke API key",
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };
  
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
  
  const startEditingUser = (user: UserWithRoles) => {
    setEditingUserId(user.id);
    setEditUserData({
      name: user.name,
      email: user.email,
      roleId: user.roles[0]?.id || ""
    });
  };
  
  const cancelEditingUser = () => {
    setEditingUserId(null);
    setEditUserData({name: "", email: "", roleId: ""});
  };
  
  const saveUserChanges = () => {
    if (!editingUserId) return;
    updateUserMutation.mutate({
      id: editingUserId,
      ...editUserData
    });
  };
  
  const handleCreateUser = () => {
    if (!newUserData.name || !newUserData.email || !newUserData.password || !newUserData.roleId) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }
    createUserMutation.mutate(newUserData);
  };

  const startEditingCategory = (category: AccountCategory) => {
    setEditingCategoryId(category.id);
    setEditCategoryData({
      name: category.name,
      description: category.description || "",
      isActive: category.isActive
    });
  };

  const cancelEditingCategory = () => {
    setEditingCategoryId(null);
    setEditCategoryData({name: "", description: "", isActive: true});
  };

  const saveCategoryChanges = () => {
    if (!editingCategoryId) return;
    updateCategoryMutation.mutate({
      id: editingCategoryId,
      ...editCategoryData
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryData.name) {
      toast({
        title: "Missing required field",
        description: "Please enter a category name",
        variant: "destructive"
      });
      return;
    }
    createCategoryMutation.mutate(newCategoryData);
  };

  const handleDynamicsTransform = async () => {
    if (!dynamicsExcelFile || !dynamicsMapping || !dynamicsTemplate) {
      toast({
        title: "Missing files",
        description: "Please upload all three required files",
        variant: "destructive"
      });
      return;
    }

    setTransforming(true);
    try {
      const formData = new FormData();
      formData.append('excelFile', dynamicsExcelFile);
      formData.append('mappingConfig', dynamicsMapping);
      formData.append('templateCsv', dynamicsTemplate);

      const endpoint = dynamicsEntityType === "contacts" 
        ? '/api/admin/dynamics/transform-contacts'
        : dynamicsEntityType === "leads"
        ? '/api/admin/dynamics/transform-leads'
        : dynamicsEntityType === "opportunities"
        ? '/api/admin/dynamics/transform-opportunities'
        : dynamicsEntityType === "activities"
        ? '/api/admin/dynamics/transform-activities'
        : '/api/admin/dynamics/transform-accounts';

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || 'Transform failed');
      }

      // Download the resulting CSV
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dynamicsEntityType}_aligned.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Transform successful",
        description: "Aligned CSV file downloaded successfully"
      });

      // Reset files
      setDynamicsExcelFile(null);
      setDynamicsMapping(null);
      setDynamicsTemplate(null);
    } catch (error: any) {
      toast({
        title: "Transform failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setTransforming(false);
    }
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
          <TabsTrigger value="categories" data-testid="tab-categories">Categories</TabsTrigger>
          <TabsTrigger value="api-keys" data-testid="tab-api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="api-logs" data-testid="tab-api-logs">API Access Logs</TabsTrigger>
          <TabsTrigger value="backup" data-testid="tab-backup">Backup & Restore</TabsTrigger>
          <TabsTrigger value="dynamics" data-testid="tab-dynamics">Dynamics Import</TabsTrigger>
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
                <Button onClick={() => setCreateUserOpen(true)} data-testid="button-create-user">
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
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((user) => {
                    const isEditing = editingUserId === user.id;
                    return (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">
                          {isEditing ? (
                            <Input 
                              value={editUserData.name}
                              onChange={(e) => setEditUserData({...editUserData, name: e.target.value})}
                              data-testid={`input-edit-name-${user.id}`}
                            />
                          ) : (
                            user.name
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input 
                              type="email"
                              value={editUserData.email}
                              onChange={(e) => setEditUserData({...editUserData, email: e.target.value})}
                              data-testid={`input-edit-email-${user.id}`}
                            />
                          ) : (
                            user.email
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Select 
                              value={editUserData.roleId}
                              onValueChange={(value) => setEditUserData({...editUserData, roleId: value})}
                            >
                              <SelectTrigger data-testid={`select-edit-role-${user.id}`}>
                                <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent>
                                {roles?.map((role) => (
                                  <SelectItem key={role.id} value={role.id}>
                                    {role.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary">
                              {user.roles[0]?.name || "No role"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.status === "active" ? "default" : "secondary"}>
                            {user.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex gap-2">
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={saveUserChanges}
                                disabled={updateUserMutation.isPending}
                                data-testid={`button-save-user-${user.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={cancelEditingUser}
                                disabled={updateUserMutation.isPending}
                                data-testid={`button-cancel-edit-${user.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => startEditingUser(user)}
                              data-testid={`button-edit-user-${user.id}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

        {/* Categories Tab */}
        <TabsContent value="categories" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Category Management</CardTitle>
                  <CardDescription>Manage account categories for organization</CardDescription>
                </div>
                <Button onClick={() => setCreateCategoryOpen(true)} data-testid="button-create-category">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories?.map((category) => {
                    const isEditing = editingCategoryId === category.id;
                    return (
                      <TableRow key={category.id} data-testid={`row-category-${category.id}`}>
                        <TableCell className="font-medium">
                          {isEditing ? (
                            <Input 
                              value={editCategoryData.name}
                              onChange={(e) => setEditCategoryData({...editCategoryData, name: e.target.value})}
                              data-testid={`input-edit-category-name-${category.id}`}
                            />
                          ) : (
                            category.name
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Input 
                              value={editCategoryData.description}
                              onChange={(e) => setEditCategoryData({...editCategoryData, description: e.target.value})}
                              data-testid={`input-edit-category-description-${category.id}`}
                            />
                          ) : (
                            <span className="text-sm text-muted-foreground">{category.description || "-"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <Switch
                              checked={editCategoryData.isActive}
                              onCheckedChange={(checked) => setEditCategoryData({...editCategoryData, isActive: checked})}
                              data-testid={`switch-edit-category-active-${category.id}`}
                            />
                          ) : (
                            <Badge variant={category.isActive ? "default" : "secondary"}>
                              {category.isActive ? "Active" : "Inactive"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex gap-2">
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={saveCategoryChanges}
                                disabled={updateCategoryMutation.isPending}
                                data-testid={`button-save-category-${category.id}`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={cancelEditingCategory}
                                disabled={updateCategoryMutation.isPending}
                                data-testid={`button-cancel-edit-category-${category.id}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={() => startEditingCategory(category)}
                                data-testid={`button-edit-category-${category.id}`}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost"
                                onClick={() => setCategoryToDelete(category)}
                                data-testid={`button-delete-category-${category.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="api-keys" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Key Management
                  </CardTitle>
                  <CardDescription>Manage API keys for external integrations</CardDescription>
                </div>
                <Button onClick={() => setCreateApiKeyOpen(true)} data-testid="button-create-api-key">
                  <Plus className="h-4 w-4 mr-2" />
                  Generate API Key
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!apiKeys?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        No API keys yet. Generate one to get started.
                      </TableCell>
                    </TableRow>
                  )}
                  {apiKeys?.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {key.description || "—"}
                      </TableCell>
                      <TableCell>
                        {key.isActive && !key.revokedAt ? (
                          <Badge variant="default" data-testid={`badge-key-active-${key.id}`}>Active</Badge>
                        ) : (
                          <Badge variant="secondary" data-testid={`badge-key-revoked-${key.id}`}>Revoked</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        {key.isActive && !key.revokedAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRevokeApiKeyId(key.id)}
                            data-testid={`button-revoke-key-${key.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Access Logs Tab */}
        <TabsContent value="api-logs">
          <ApiAccessLogsTab apiKeys={apiKeys} />
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

        {/* Dynamics Import Tab */}
        <TabsContent value="dynamics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dynamics 365 Import</CardTitle>
              <CardDescription>
                Transform Dynamics 365 Excel exports into Health Trixss CRM-aligned CSV format
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="dynamics-entity-type">Entity Type</Label>
                  <Select
                    value={dynamicsEntityType}
                    onValueChange={(value: "accounts" | "contacts" | "leads" | "opportunities" | "activities") => {
                      setDynamicsEntityType(value);
                      setDynamicsExcelFile(null);
                      setDynamicsMapping(null);
                      setDynamicsTemplate(null);
                    }}
                  >
                    <SelectTrigger id="dynamics-entity-type" data-testid="select-dynamics-entity-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="accounts">Accounts</SelectItem>
                      <SelectItem value="contacts">Contacts</SelectItem>
                      <SelectItem value="leads">Leads</SelectItem>
                      <SelectItem value="opportunities">Opportunities</SelectItem>
                      <SelectItem value="activities">Activities</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    {dynamicsEntityType === "contacts" 
                      ? "Transform Dynamics 365 contacts with automatic account linking"
                      : dynamicsEntityType === "leads"
                      ? "Transform Dynamics 365 leads with topic and status mapping"
                      : dynamicsEntityType === "opportunities"
                      ? "Transform Dynamics 365 opportunities with computed fields and account linking"
                      : dynamicsEntityType === "activities"
                      ? "Transform Dynamics 365 activities with entity relationship mapping"
                      : "Transform Dynamics 365 accounts with enriched fields"}
                  </p>
                </div>

                {/* Pre-flight check for activities import */}
                {dynamicsEntityType === "activities" && dbDiagnostics && (
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-primary" />
                        <CardTitle className="text-base">Database Entity Status</CardTitle>
                      </div>
                      <CardDescription>
                        Activities require existing entities to link to. Verify entities exist before importing.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Accounts:</span>
                            <Badge 
                              variant={dbDiagnostics.entities?.accounts?.totalCount > 0 ? "default" : "secondary"}
                              data-testid="badge-accounts-count"
                            >
                              {dbDiagnostics.entities?.accounts?.totalCount || 0}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Contacts:</span>
                            <Badge 
                              variant={dbDiagnostics.entities?.contacts?.totalCount > 0 ? "default" : "secondary"}
                              data-testid="badge-contacts-count"
                            >
                              {dbDiagnostics.entities?.contacts?.totalCount || 0}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Leads:</span>
                            <Badge 
                              variant={dbDiagnostics.entities?.leads?.totalCount > 0 ? "default" : "secondary"}
                              data-testid="badge-leads-count"
                            >
                              {dbDiagnostics.entities?.leads?.totalCount || 0}
                            </Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Opportunities:</span>
                            <Badge 
                              variant={dbDiagnostics.entities?.opportunities?.totalCount > 0 ? "default" : "secondary"}
                              data-testid="badge-opportunities-count"
                            >
                              {dbDiagnostics.entities?.opportunities?.totalCount || 0}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      
                      {dbDiagnostics.entities && (
                        (dbDiagnostics.entities.accounts?.totalCount === 0 && 
                         dbDiagnostics.entities.contacts?.totalCount === 0 && 
                         dbDiagnostics.entities.leads?.totalCount === 0 && 
                         dbDiagnostics.entities.opportunities?.totalCount === 0) ? (
                          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-destructive">No entities found</p>
                              <p className="text-xs text-muted-foreground">
                                Import Accounts, Contacts, Leads, or Opportunities first before importing activities.
                                Activities need to be linked to existing entities.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20">
                            <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-green-600 dark:text-green-400">
                              Entities available for activity linking
                            </p>
                          </div>
                        )
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <Label htmlFor="dynamics-excel">Excel File</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload the Dynamics 365 export Excel file (e.g., Active Accounts.xlsx)
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="dynamics-excel"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => setDynamicsExcelFile(e.target.files?.[0] || null)}
                      data-testid="input-dynamics-excel"
                    />
                    {dynamicsExcelFile && (
                      <Badge variant="secondary" data-testid="badge-excel-uploaded">
                        {dynamicsExcelFile.name}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dynamics-mapping">Mapping Configuration (JSON)</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload the mapping config file (e.g., dynamics_mapping_config.json)
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="dynamics-mapping"
                      type="file"
                      accept=".json"
                      onChange={(e) => setDynamicsMapping(e.target.files?.[0] || null)}
                      data-testid="input-dynamics-mapping"
                    />
                    {dynamicsMapping && (
                      <Badge variant="secondary" data-testid="badge-mapping-uploaded">
                        {dynamicsMapping.name}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dynamics-template">Template CSV</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload the target template CSV file (e.g., accounts-template.dynamics.csv)
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      id="dynamics-template"
                      type="file"
                      accept=".csv"
                      onChange={(e) => setDynamicsTemplate(e.target.files?.[0] || null)}
                      data-testid="input-dynamics-template"
                    />
                    {dynamicsTemplate && (
                      <Badge variant="secondary" data-testid="badge-template-uploaded">
                        {dynamicsTemplate.name}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    onClick={handleDynamicsTransform}
                    disabled={!dynamicsExcelFile || !dynamicsMapping || !dynamicsTemplate || transforming}
                    className="w-full"
                    data-testid="button-transform-accounts"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {transforming ? "Transforming..." : "Transform & Download Aligned CSV"}
                  </Button>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium mb-2">What this does:</h3>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Reads your Dynamics 365 Excel export</li>
                    <li>Maps columns according to the configuration</li>
                    <li>Generates or preserves Record IDs</li>
                    <li>Validates emails, phones, URLs, states, and postal codes</li>
                    <li>Removes duplicate entries</li>
                    {dynamicsEntityType === "contacts" && (
                      <li>Automatically links contacts to existing accounts by company name</li>
                    )}
                    {dynamicsEntityType === "opportunities" && (
                      <>
                        <li>Automatically links opportunities to existing accounts</li>
                        <li>Computes stage, amount, closeDate, and probability from Dynamics fields</li>
                        <li>Preserves Dynamics opportunity numbers or generates new IDs</li>
                      </>
                    )}
                    {dynamicsEntityType === "activities" && (
                      <li>Maps "Regarding" field to multiple entity types (Account, Contact, Lead, Opportunity)</li>
                    )}
                    <li>Adds governance metadata (Source System, Import Status)</li>
                    <li>Outputs CSV aligned with Health Trixss CRM template</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
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
                <Label>Clear All Accounts</Label>
                <p className="text-sm text-muted-foreground">
                  Delete all accounts and related data (contacts, opportunities, activities, comments). Useful for re-importing fresh data from Dynamics 365.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmClearAccountsOpen(true)}
                  data-testid="button-clear-accounts"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All Accounts
                </Button>
              </div>
              
              <div className="border-t pt-4 space-y-2">
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

              <div className="border-t pt-4 space-y-2">
                <Label className="text-destructive">System Reset (Delete All Users)</Label>
                <p className="text-sm text-muted-foreground">
                  Delete all user accounts and log everyone out. The next registration will automatically become Admin. Use this to completely reset user access.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmSystemResetOpen(true)}
                  data-testid="button-system-reset"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  System Reset
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

      {/* Confirm Clear Accounts Dialog */}
      <AlertDialog open={confirmClearAccountsOpen} onOpenChange={setConfirmClearAccountsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all accounts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all accounts and related data including contacts, opportunities, activities, and account comments.
              This is useful when you want to re-import fresh data from Dynamics 365. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-clear-accounts">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearAccountsMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-clear-accounts"
            >
              Yes, clear all accounts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* Confirm System Reset Dialog */}
      <AlertDialog open={confirmSystemResetOpen} onOpenChange={setConfirmSystemResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              System Reset - Delete All Users?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p className="font-semibold">This will permanently delete ALL user accounts including yours!</p>
              <p>After this action:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>All users will be logged out immediately</li>
                <li>All user accounts will be deleted</li>
                <li>The next registration will become Admin</li>
                <li>You will need to re-register to access the system</li>
              </ul>
              <p className="font-semibold text-destructive">This action cannot be undone!</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-system-reset">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => systemResetMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-system-reset"
            >
              Yes, delete all users and reset system
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Create User Dialog */}
      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent data-testid="dialog-create-user">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Add a new user to the system and assign a role
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Full Name</Label>
              <Input
                id="new-user-name"
                value={newUserData.name}
                onChange={(e) => setNewUserData({...newUserData, name: e.target.value})}
                placeholder="John Doe"
                data-testid="input-new-user-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={newUserData.email}
                onChange={(e) => setNewUserData({...newUserData, email: e.target.value})}
                placeholder="john.doe@example.com"
                data-testid="input-new-user-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={newUserData.password}
                onChange={(e) => setNewUserData({...newUserData, password: e.target.value})}
                placeholder="••••••••"
                data-testid="input-new-user-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-role">Role</Label>
              <Select
                value={newUserData.roleId}
                onValueChange={(value) => setNewUserData({...newUserData, roleId: value})}
              >
                <SelectTrigger id="new-user-role" data-testid="select-new-user-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles?.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateUserOpen(false)}
              disabled={createUserMutation.isPending}
              data-testid="button-cancel-create-user"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateUser}
              disabled={createUserMutation.isPending}
              data-testid="button-save-new-user"
            >
              {createUserMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Category Dialog */}
      <Dialog open={createCategoryOpen} onOpenChange={setCreateCategoryOpen}>
        <DialogContent data-testid="dialog-create-category">
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>
              Add a new account category for organization
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-category-name">Name *</Label>
              <Input
                id="new-category-name"
                value={newCategoryData.name}
                onChange={(e) => setNewCategoryData({...newCategoryData, name: e.target.value})}
                placeholder="Provider"
                data-testid="input-category-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-category-description">Description</Label>
              <Input
                id="new-category-description"
                value={newCategoryData.description}
                onChange={(e) => setNewCategoryData({...newCategoryData, description: e.target.value})}
                placeholder="Healthcare provider organizations"
                data-testid="input-category-description"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="new-category-active"
                checked={newCategoryData.isActive}
                onCheckedChange={(checked) => setNewCategoryData({...newCategoryData, isActive: checked})}
                data-testid="switch-category-active"
              />
              <Label htmlFor="new-category-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateCategoryOpen(false)}
              disabled={createCategoryMutation.isPending}
              data-testid="button-cancel-create-category"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateCategory}
              disabled={createCategoryMutation.isPending}
              data-testid="button-save-category"
            >
              {createCategoryMutation.isPending ? "Creating..." : "Create Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Confirmation Dialog */}
      <AlertDialog open={!!categoryToDelete} onOpenChange={() => setCategoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the category "{categoryToDelete?.name}"? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-category">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => categoryToDelete && deleteCategoryMutation.mutate(categoryToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-category"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create API Key Dialog */}
      <Dialog open={createApiKeyOpen} onOpenChange={setCreateApiKeyOpen}>
        <DialogContent data-testid="dialog-create-api-key">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for external integrations (e.g., forecasting app)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name *</Label>
              <Input
                id="api-key-name"
                value={newApiKeyData.name}
                onChange={(e) => setNewApiKeyData({...newApiKeyData, name: e.target.value})}
                placeholder="Forecasting App Integration"
                data-testid="input-api-key-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-description">Description</Label>
              <Input
                id="api-key-description"
                value={newApiKeyData.description}
                onChange={(e) => setNewApiKeyData({...newApiKeyData, description: e.target.value})}
                placeholder="Used by external forecasting application"
                data-testid="input-api-key-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key-expires">Expires At (optional)</Label>
              <Input
                id="api-key-expires"
                type="date"
                value={newApiKeyData.expiresAt}
                onChange={(e) => setNewApiKeyData({...newApiKeyData, expiresAt: e.target.value})}
                data-testid="input-api-key-expires"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateApiKeyOpen(false)}
              disabled={createApiKeyMutation.isPending}
              data-testid="button-cancel-create-api-key"
            >
              Cancel
            </Button>
            <Button
              onClick={() => createApiKeyMutation.mutate(newApiKeyData)}
              disabled={createApiKeyMutation.isPending || !newApiKeyData.name}
              data-testid="button-save-api-key"
            >
              {createApiKeyMutation.isPending ? "Generating..." : "Generate API Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated API Key Dialog (shown once) */}
      <Dialog open={!!generatedApiKey} onOpenChange={() => setGeneratedApiKey(null)}>
        <DialogContent data-testid="dialog-generated-api-key">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              API Key Generated
            </DialogTitle>
            <DialogDescription>
              This is the only time the API key will be shown. Save it securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <p className="text-sm font-medium">{generatedApiKey?.name}</p>
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <div className="flex gap-2">
                <Input
                  value={generatedApiKey?.key || ""}
                  readOnly
                  className="font-mono text-sm"
                  data-testid="input-generated-api-key"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => generatedApiKey && copyToClipboard(generatedApiKey.key)}
                  data-testid="button-copy-api-key"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                    Save this key now!
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    You won't be able to see it again. Store it in a secure location.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setGeneratedApiKey(null)}
              data-testid="button-close-api-key-dialog"
            >
              I've Saved It
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke API Key Confirmation Dialog */}
      <AlertDialog open={!!revokeApiKeyId} onOpenChange={() => setRevokeApiKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately invalidate the API key. Any applications using this key will lose access.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke-api-key">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeApiKeyId && revokeApiKeyMutation.mutate(revokeApiKeyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-revoke-api-key"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
