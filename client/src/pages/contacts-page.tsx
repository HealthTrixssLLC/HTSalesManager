// Contacts list page with enhanced filtering, sorting, and column visibility
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, Users, Mail, Phone, Download, MessageSquare, X, Building2, Tags } from "lucide-react";
import { Contact, InsertContact, insertContactSchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CommentSystem } from "@/components/comment-system";
import { ContactsSummaryCards } from "@/components/contacts-summary-cards";
import { ContactsFilterBar } from "@/components/contacts-filter-bar";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { ColumnVisibility, type Column } from "@/components/column-visibility";
import { BulkTagDialog } from "@/components/bulk-tag-dialog";

// Define available columns
const AVAILABLE_COLUMNS: Column[] = [
  { id: "id", label: "ID" },
  { id: "name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "accountId", label: "Account" },
  { id: "title", label: "Job Title" },
  { id: "ownerId", label: "Owner" },
  { id: "actions", label: "Actions" },
];

export default function ContactsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [commentsContactId, setCommentsContactId] = useState<string | null>(null);
  const [commentsContactName, setCommentsContactName] = useState<string | null>(null);

  // Bulk operations state
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [isBulkOwnerDialogOpen, setIsBulkOwnerDialogOpen] = useState(false);
  const [isBulkAccountDialogOpen, setIsBulkAccountDialogOpen] = useState(false);
  const [isBulkTagDialogOpen, setIsBulkTagDialogOpen] = useState(false);
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkAccountId, setBulkAccountId] = useState("");

  // Filter and sort state
  const [filters, setFilters] = useState({
    search: "",
    accountId: "",
    ownerId: "",
    hasEmail: "",
    tagIds: [] as string[],
  });
  const [sortBy, setSortBy] = useState("firstName");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.map(c => c.id)
  );

  // Build query string for API
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.append("search", filters.search);
    if (filters.accountId) params.append("accountId", filters.accountId);
    if (filters.ownerId) params.append("ownerId", filters.ownerId);
    if (filters.hasEmail) params.append("hasEmail", filters.hasEmail);
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    return params.toString();
  }, [filters, sortBy, sortOrder]);

  // Fetch all contacts (for total count)
  const { data: allContacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  // Fetch filtered contacts
  const { data: filteredContacts, isLoading } = useQuery<Contact[]>({
    queryKey: ["/api/contacts", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/contacts?${queryString}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return res.json();
    },
  });

  const { data: accounts } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/accounts"],
  });

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
  });

  // Fetch all entity tags for client-side filtering
  const { data: allEntityTags } = useQuery<Array<{ entityId: string; tagId: string }>>({
    queryKey: ["/api/entity-tags-contacts"],
    queryFn: async () => {
      // Fetch tags for all contacts
      const contactTagsPromises = (allContacts || []).map(async (contact) => {
        const res = await fetch(`/api/contacts/${contact.id}/tags`, {
          credentials: "include",
        });
        if (!res.ok) return [];
        const tags = await res.json();
        return tags.map((tag: any) => ({ entityId: contact.id, tagId: tag.id }));
      });
      const results = await Promise.all(contactTagsPromises);
      return results.flat();
    },
    enabled: !!allContacts && allContacts.length > 0,
  });

  // Apply client-side tag filtering
  const displayedContacts = useMemo(() => {
    if (!filteredContacts) return [];
    if (filters.tagIds.length === 0) return filteredContacts;

    return filteredContacts.filter((contact) => {
      const contactTags = allEntityTags?.filter(et => et.entityId === contact.id).map(et => et.tagId) || [];
      return filters.tagIds.some(tagId => contactTags.includes(tagId));
    });
  }, [filteredContacts, filters.tagIds, allEntityTags]);

  const createMutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact created successfully" });
      setIsCreateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create contact", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ contactIds, updates }: { contactIds: string[]; updates: any }) => {
      const res = await apiRequest("POST", "/api/contacts/bulk-update", { contactIds, updates });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: `Successfully updated ${data.count} contact${data.count !== 1 ? 's' : ''}` });
      setSelectedContactIds(new Set());
      setIsBulkOwnerDialogOpen(false);
      setIsBulkAccountDialogOpen(false);
      setBulkOwnerId("");
      setBulkAccountId("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to bulk update contacts", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertContact>({
    resolver: zodResolver(insertContactSchema),
    defaultValues: {
      id: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      title: "",
      ownerId: user?.id || "",
      accountId: null,
    },
  });

  const onSubmit = (data: InsertContact) => {
    createMutation.mutate(data);
  };

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/contacts", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Export failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Contacts exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export Contacts", variant: "destructive" });
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

  const handleCardClick = useCallback((filterType: string, filterValue: string) => {
    if (filterType === "hasEmail") {
      setFilters(prev => ({ ...prev, hasEmail: filterValue }));
    } else if (filterType === "new") {
      // For new contacts, we can just show all contacts - the card already calculated this
      // In a real implementation, you might add a date filter
      setFilters(prev => ({ ...prev, search: "" }));
    } else if (filterType === "source") {
      // Filter by whether contact has account or not
      if (filterValue === "account") {
        // Filter to show only contacts with accounts - this would need backend support
        setFilters(prev => ({ ...prev, search: "" }));
      } else {
        setFilters(prev => ({ ...prev, search: "" }));
      }
    } else {
      // Reset all filters for "Total" card
      setFilters({ search: "", accountId: "", ownerId: "", hasEmail: "", tagIds: [] });
    }
  }, []);

  const isColumnVisible = (columnId: string) => visibleColumns.includes(columnId);

  const getAccountName = (accountId: string | null) => {
    if (!accountId) return "None";
    const account = accounts?.find(a => a.id === accountId);
    return account?.name || "Unknown";
  };

  const getOwnerName = (ownerId: string | null) => {
    if (!ownerId) return "Unassigned";
    const owner = users?.find(u => u.id === ownerId);
    return owner?.name || "Unknown";
  };

  // Bulk selection helpers
  const toggleContactSelection = (contactId: string) => {
    const newSelection = new Set(selectedContactIds);
    if (newSelection.has(contactId)) {
      newSelection.delete(contactId);
    } else {
      newSelection.add(contactId);
    }
    setSelectedContactIds(newSelection);
  };

  const selectAllContacts = () => {
    if (displayedContacts) {
      setSelectedContactIds(new Set(displayedContacts.map(c => c.id)));
    }
  };

  const clearSelection = () => {
    setSelectedContactIds(new Set());
  };

  const handleBulkAssignOwner = () => {
    if (!bulkOwnerId) {
      toast({ title: "Please select an owner", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({
      contactIds: Array.from(selectedContactIds),
      updates: { ownerId: bulkOwnerId },
    });
  };

  const handleBulkChangeAccount = () => {
    bulkUpdateMutation.mutate({
      contactIds: Array.from(selectedContactIds),
      updates: { accountId: bulkAccountId || null },
    });
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
          <h1 className="text-3xl font-semibold text-foreground">Contacts</h1>
          <p className="text-muted-foreground">Manage your business contacts and relationships</p>
        </div>
        <div className="flex gap-2">
          <ColumnVisibility
            columns={AVAILABLE_COLUMNS.filter(c => c.id !== "actions")}
            storageKey="contacts-visible-columns"
            onVisibilityChange={handleColumnVisibilityChange}
          />
          <Button variant="outline" onClick={handleExport} data-testid="button-export-contacts">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-contact">
                <Plus className="h-4 w-4 mr-2" />
                New Contact
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Contact</DialogTitle>
              <DialogDescription>Add a new contact to your CRM</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Will be auto-generated if left blank" {...field} data-testid="input-contact-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="John" {...field} data-testid="input-contact-first-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Doe" {...field} data-testid="input-contact-last-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} value={field.value || ""} data-testid="input-contact-email" />
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
                        <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-contact-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Job Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Sales Manager" {...field} value={field.value || ""} data-testid="input-contact-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-contact">
                    {createMutation.isPending ? "Creating..." : "Create Contact"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <ContactsSummaryCards onCardClick={handleCardClick} />

      <ContactsFilterBar
        onFilterChange={handleFilterChange}
        totalCount={allContacts?.length || 0}
        filteredCount={displayedContacts?.length || 0}
      />

      {selectedContactIds.size > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium" data-testid="text-selected-count">
                {selectedContactIds.size} contact{selectedContactIds.size !== 1 ? 's' : ''} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                data-testid="button-clear-selection"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Dialog open={isBulkOwnerDialogOpen} onOpenChange={setIsBulkOwnerDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-bulk-assign-owner">
                    <Users className="h-4 w-4 mr-1" />
                    Assign Owner
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign Owner to {selectedContactIds.size} Contacts</DialogTitle>
                    <DialogDescription>
                      Select a new owner for the selected contacts
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Select value={bulkOwnerId} onValueChange={setBulkOwnerId}>
                      <SelectTrigger data-testid="select-bulk-owner">
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        {users?.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsBulkOwnerDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleBulkAssignOwner} 
                      disabled={bulkUpdateMutation.isPending}
                      data-testid="button-confirm-bulk-owner"
                    >
                      {bulkUpdateMutation.isPending ? "Updating..." : "Assign Owner"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isBulkAccountDialogOpen} onOpenChange={setIsBulkAccountDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-bulk-change-account">
                    <Building2 className="h-4 w-4 mr-1" />
                    Change Account
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Change Account for {selectedContactIds.size} Contacts</DialogTitle>
                    <DialogDescription>
                      Select a new account for the selected contacts
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <Select value={bulkAccountId} onValueChange={setBulkAccountId}>
                      <SelectTrigger data-testid="select-bulk-account">
                        <SelectValue placeholder="Select account (or none)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {accounts?.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsBulkAccountDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleBulkChangeAccount} 
                      disabled={bulkUpdateMutation.isPending}
                      data-testid="button-confirm-bulk-account"
                    >
                      {bulkUpdateMutation.isPending ? "Updating..." : "Change Account"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setIsBulkTagDialogOpen(true)}
                data-testid="button-bulk-add-tags"
              >
                <Tags className="h-4 w-4 mr-1" />
                Bulk Add Tags
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedContactIds.size > 0 && selectedContactIds.size === displayedContacts?.length}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        selectAllContacts();
                      } else {
                        clearSelection();
                      }
                    }}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
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
                    field="firstName"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("email") && (
                  <SortableTableHeader
                    label="Email"
                    field="email"
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
                {isColumnVisible("accountId") && (
                  <SortableTableHeader
                    label="Account"
                    field="accountId"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("title") && (
                  <SortableTableHeader
                    label="Job Title"
                    field="title"
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
                {isColumnVisible("actions") && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedContacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={AVAILABLE_COLUMNS.length + 1} className="text-center py-8 text-muted-foreground">
                    No contacts found. {filters.search || filters.accountId || filters.ownerId || filters.hasEmail || filters.tagIds.length > 0 ? "Try adjusting your filters." : "Create your first contact to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                displayedContacts?.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer hover-elevate"
                    data-testid={`row-contact-${contact.id}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedContactIds.has(contact.id)}
                        onCheckedChange={() => toggleContactSelection(contact.id)}
                        data-testid={`checkbox-contact-${contact.id}`}
                      />
                    </TableCell>
                    {isColumnVisible("id") && (
                      <TableCell className="font-medium" onClick={() => setLocation(`/contacts/${contact.id}`)} data-testid={`cell-id-${contact.id}`}>
                        {contact.id}
                      </TableCell>
                    )}
                    {isColumnVisible("name") && (
                      <TableCell className="font-medium" onClick={() => setLocation(`/contacts/${contact.id}`)} data-testid={`cell-name-${contact.id}`}>
                        {contact.firstName} {contact.lastName}
                      </TableCell>
                    )}
                    {isColumnVisible("email") && (
                      <TableCell onClick={(e) => e.stopPropagation()} data-testid={`cell-email-${contact.id}`}>
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`} className="text-primary hover:underline flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {contact.email}
                          </a>
                        ) : "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("phone") && (
                      <TableCell data-testid={`cell-phone-${contact.id}`}>
                        {contact.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {contact.phone}
                          </span>
                        ) : "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("accountId") && (
                      <TableCell onClick={() => setLocation(`/contacts/${contact.id}`)} data-testid={`cell-account-${contact.id}`}>
                        {getAccountName(contact.accountId)}
                      </TableCell>
                    )}
                    {isColumnVisible("title") && (
                      <TableCell onClick={() => setLocation(`/contacts/${contact.id}`)} data-testid={`cell-title-${contact.id}`}>
                        {contact.title || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("ownerId") && (
                      <TableCell onClick={() => setLocation(`/contacts/${contact.id}`)} data-testid={`cell-owner-${contact.id}`}>
                        {getOwnerName(contact.ownerId)}
                      </TableCell>
                    )}
                    {isColumnVisible("actions") && (
                      <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={() => {
                            setCommentsContactId(contact.id);
                            setCommentsContactName(`${contact.firstName} ${contact.lastName}`);
                          }}
                          data-testid={`button-comments-${contact.id}`}
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={commentsContactId !== null} onOpenChange={(open) => !open && setCommentsContactId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comments</DialogTitle>
          </DialogHeader>
          {commentsContactId && (
            <CommentSystem
              entity="contacts"
              entityId={commentsContactId}
              entityName={commentsContactName || undefined}
            />
          )}
        </DialogContent>
      </Dialog>

      <BulkTagDialog
        open={isBulkTagDialogOpen}
        onOpenChange={setIsBulkTagDialogOpen}
        selectedIds={Array.from(selectedContactIds)}
        entity="contacts"
      />
    </div>
  );
}
