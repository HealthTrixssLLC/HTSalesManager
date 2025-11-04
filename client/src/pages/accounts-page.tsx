// Accounts list page with enhanced filtering, sorting, and column visibility
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Pencil, Trash2, Loader2, Download, MessageSquare } from "lucide-react";
import { Account, InsertAccount, insertAccountSchema, AccountCategory } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { CommentSystem } from "@/components/comment-system";
import { AccountsSummaryCards } from "@/components/accounts-summary-cards";
import { AccountsFilterBar } from "@/components/accounts-filter-bar";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { ColumnVisibility, type Column } from "@/components/column-visibility";

// Define available columns
const AVAILABLE_COLUMNS: Column[] = [
  { id: "id", label: "ID" },
  { id: "name", label: "Name" },
  { id: "accountNumber", label: "Account Number" },
  { id: "type", label: "Type" },
  { id: "category", label: "Category" },
  { id: "ownerId", label: "Owner" },
  { id: "industry", label: "Industry" },
  { id: "phone", label: "Phone" },
  { id: "website", label: "Website" },
  { id: "actions", label: "Actions" },
];

export default function AccountsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [commentsAccountId, setCommentsAccountId] = useState<string | null>(null);
  const [commentsAccountName, setCommentsAccountName] = useState<string | null>(null);

  // Filter and sort state
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    category: "",
    ownerId: "",
  });
  const [sortBy, setSortBy] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.map(c => c.id)
  );

  // Build query string for API
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.append("search", filters.search);
    if (filters.type) params.append("type", filters.type);
    if (filters.category) params.append("category", filters.category);
    if (filters.ownerId) params.append("ownerId", filters.ownerId);
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    return params.toString();
  }, [filters, sortBy, sortOrder]);

  // Fetch all accounts (for total count)
  const { data: allAccounts } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  // Fetch filtered accounts
  const { data: filteredAccounts, isLoading } = useQuery<Account[]>({
    queryKey: ["/api/accounts", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/accounts?${queryString}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
  });

  const { data: categories } = useQuery<AccountCategory[]>({
    queryKey: ["/api/admin/categories"],
  });

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertAccount) => {
      const res = await apiRequest("POST", "/api/accounts", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account created successfully" });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create account", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: InsertAccount & { id: string }) => {
      const res = await apiRequest("PATCH", `/api/accounts/${data.id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account updated successfully" });
      setIsEditDialogOpen(false);
      setEditingAccount(null);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update account", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertAccount>({
    resolver: zodResolver(insertAccountSchema),
    defaultValues: {
      id: "",
      name: "",
      accountNumber: "",
      category: "",
      type: "customer",
      ownerId: user?.id || "",
      industry: "",
      website: "",
      phone: "",
      primaryContactName: "",
      primaryContactEmail: "",
      billingAddress: "",
      shippingAddress: "",
    },
  });

  const onSubmit = (data: InsertAccount) => {
    if (editingAccount) {
      updateMutation.mutate({ ...data, id: editingAccount.id });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    form.reset({
      id: account.id,
      name: account.name,
      accountNumber: account.accountNumber || "",
      category: account.category || "",
      type: account.type,
      ownerId: account.ownerId,
      industry: account.industry || "",
      website: account.website || "",
      phone: account.phone || "",
      primaryContactName: account.primaryContactName || "",
      primaryContactEmail: account.primaryContactEmail || "",
      billingAddress: account.billingAddress || "",
      shippingAddress: account.shippingAddress || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleCreateNew = () => {
    setEditingAccount(null);
    form.reset({
      id: "",
      name: "",
      accountNumber: "",
      category: "",
      type: "customer",
      ownerId: user?.id || "",
      industry: "",
      website: "",
      phone: "",
      primaryContactName: "",
      primaryContactEmail: "",
      billingAddress: "",
      shippingAddress: "",
    });
    setIsCreateDialogOpen(true);
  };

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/accounts", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Export failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `accounts-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Accounts exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export accounts", variant: "destructive" });
    }
  };

  const handleFilterChange = useCallback((newFilters: typeof filters) => {
    setFilters(newFilters);
  }, []);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const handleColumnVisibilityChange = useCallback((columns: string[]) => {
    setVisibleColumns(columns);
  }, []);

  const isColumnVisible = (columnId: string) => visibleColumns.includes(columnId);

  const getOwnerName = (ownerId: string | null) => {
    if (!ownerId) return "Unassigned";
    const owner = users?.find(u => u.id === ownerId);
    return owner?.name || "Unknown";
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Accounts</h1>
          <p className="text-muted-foreground">Manage your customer accounts and organizations</p>
        </div>
        <div className="flex gap-2">
          <ColumnVisibility
            columns={AVAILABLE_COLUMNS.filter(c => c.id !== "actions")}
            storageKey="accounts-visible-columns"
            onVisibilityChange={handleColumnVisibilityChange}
          />
          <Button variant="outline" onClick={handleExport} data-testid="button-export-accounts">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleCreateNew} data-testid="button-create-account">
                <Plus className="h-4 w-4 mr-2" />
                New Account
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingAccount ? "Edit Account" : "Create New Account"}</DialogTitle>
                <DialogDescription>
                  {editingAccount ? "Update account information" : "Add a new account to your CRM"}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account ID</FormLabel>
                        <FormControl>
                          <Input placeholder="Will be auto-generated if left blank" {...field} data-testid="input-account-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Acme Corporation" {...field} data-testid="input-account-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="accountNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Account Number</FormLabel>
                          <FormControl>
                            <Input placeholder="ACC-12345" {...field} value={field.value || ""} data-testid="input-account-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-account-category">
                                <SelectValue placeholder="Select a category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories?.filter(c => c.isActive).map((category) => (
                                <SelectItem key={category.id} value={category.name}>
                                  {category.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger data-testid="select-account-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="customer">Customer</SelectItem>
                            <SelectItem value="prospect">Prospect</SelectItem>
                            <SelectItem value="partner">Partner</SelectItem>
                            <SelectItem value="vendor">Vendor</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="industry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Industry</FormLabel>
                          <FormControl>
                            <Input placeholder="Healthcare" {...field} value={field.value || ""} data-testid="input-account-industry" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-account-phone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com" {...field} value={field.value || ""} data-testid="input-account-website" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-submit-account">
                      {createMutation.isPending || updateMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {editingAccount ? "Updating..." : "Creating..."}
                        </>
                      ) : (
                        <>{editingAccount ? "Update Account" : "Create Account"}</>
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <AccountsSummaryCards />

      <AccountsFilterBar
        onFilterChange={handleFilterChange}
        totalCount={allAccounts?.length || 0}
        filteredCount={filteredAccounts?.length || 0}
      />

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {isColumnVisible("id") && (
                  <SortableTableHeader
                    label="ID"
                    field="id"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("name") && (
                  <SortableTableHeader
                    label="Name"
                    field="name"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("accountNumber") && (
                  <SortableTableHeader
                    label="Account Number"
                    field="accountNumber"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("type") && (
                  <SortableTableHeader
                    label="Type"
                    field="type"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("category") && (
                  <SortableTableHeader
                    label="Category"
                    field="category"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("ownerId") && (
                  <SortableTableHeader
                    label="Owner"
                    field="ownerId"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("industry") && (
                  <SortableTableHeader
                    label="Industry"
                    field="industry"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("phone") && (
                  <SortableTableHeader
                    label="Phone"
                    field="phone"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("website") && (
                  <SortableTableHeader
                    label="Website"
                    field="website"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("actions") && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={AVAILABLE_COLUMNS.length} className="text-center py-8 text-muted-foreground">
                    No accounts found. {filters.search || filters.type || filters.category || filters.ownerId ? "Try adjusting your filters." : "Create your first account to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts?.map((account) => (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setLocation(`/accounts/${account.id}`)}
                    data-testid={`row-account-${account.id}`}
                  >
                    {isColumnVisible("id") && (
                      <TableCell className="font-medium" data-testid={`cell-id-${account.id}`}>
                        {account.id}
                      </TableCell>
                    )}
                    {isColumnVisible("name") && (
                      <TableCell data-testid={`cell-name-${account.id}`}>
                        {account.name}
                      </TableCell>
                    )}
                    {isColumnVisible("accountNumber") && (
                      <TableCell data-testid={`cell-accountNumber-${account.id}`}>
                        {account.accountNumber || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("type") && (
                      <TableCell className="capitalize" data-testid={`cell-type-${account.id}`}>
                        {account.type}
                      </TableCell>
                    )}
                    {isColumnVisible("category") && (
                      <TableCell data-testid={`cell-category-${account.id}`}>
                        {account.category || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("ownerId") && (
                      <TableCell data-testid={`cell-owner-${account.id}`}>
                        {getOwnerName(account.ownerId)}
                      </TableCell>
                    )}
                    {isColumnVisible("industry") && (
                      <TableCell data-testid={`cell-industry-${account.id}`}>
                        {account.industry || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("phone") && (
                      <TableCell data-testid={`cell-phone-${account.id}`}>
                        {account.phone || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("website") && (
                      <TableCell data-testid={`cell-website-${account.id}`}>
                        {account.website ? (
                          <a
                            href={account.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline"
                          >
                            {account.website}
                          </a>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    )}
                    {isColumnVisible("actions") && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCommentsAccountId(account.id);
                              setCommentsAccountName(account.name);
                            }}
                            data-testid={`button-comments-${account.id}`}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(account);
                            }}
                            data-testid={`button-edit-${account.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
            <DialogDescription>Update account information</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account ID</FormLabel>
                    <FormControl>
                      <Input {...field} disabled data-testid="input-edit-account-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Corporation" {...field} data-testid="input-edit-account-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input placeholder="ACC-12345" {...field} value={field.value || ""} data-testid="input-edit-account-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-account-category">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories?.filter(c => c.isActive).map((category) => (
                            <SelectItem key={category.id} value={category.name}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-account-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="prospect">Prospect</SelectItem>
                        <SelectItem value="partner">Partner</SelectItem>
                        <SelectItem value="vendor">Vendor</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Industry</FormLabel>
                      <FormControl>
                        <Input placeholder="Healthcare" {...field} value={field.value || ""} data-testid="input-edit-account-industry" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-edit-account-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" {...field} value={field.value || ""} data-testid="input-edit-account-website" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-edit-account">
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Account"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Comments Dialog */}
      <Dialog open={!!commentsAccountId} onOpenChange={(open) => !open && setCommentsAccountId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Comments - {commentsAccountName}</DialogTitle>
            <DialogDescription>
              Collaborate on this account with your team
            </DialogDescription>
          </DialogHeader>
          {commentsAccountId && (
            <CommentSystem
              entity="accounts"
              entityId={commentsAccountId}
              entityName={commentsAccountName || undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
