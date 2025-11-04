// Contacts list page with enhanced filtering, sorting, and column visibility
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, Users, Mail, Phone, Download, MessageSquare } from "lucide-react";
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
import { CommentSystem } from "@/components/comment-system";
import { ContactsSummaryCards } from "@/components/contacts-summary-cards";
import { ContactsFilterBar } from "@/components/contacts-filter-bar";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { ColumnVisibility, type Column } from "@/components/column-visibility";

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

  // Filter and sort state
  const [filters, setFilters] = useState({
    search: "",
    accountId: "",
    ownerId: "",
    hasEmail: "",
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

      <ContactsSummaryCards />

      <ContactsFilterBar
        onFilterChange={handleFilterChange}
        totalCount={allContacts?.length || 0}
        filteredCount={filteredContacts?.length || 0}
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
              {filteredContacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={AVAILABLE_COLUMNS.length} className="text-center py-8 text-muted-foreground">
                    No contacts found. {filters.search || filters.accountId || filters.ownerId || filters.hasEmail ? "Try adjusting your filters." : "Create your first contact to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredContacts?.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setLocation(`/contacts/${contact.id}`)}
                    data-testid={`row-contact-${contact.id}`}
                  >
                    {isColumnVisible("id") && (
                      <TableCell className="font-medium" data-testid={`cell-id-${contact.id}`}>
                        {contact.id}
                      </TableCell>
                    )}
                    {isColumnVisible("name") && (
                      <TableCell className="font-medium" data-testid={`cell-name-${contact.id}`}>
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
                      <TableCell data-testid={`cell-account-${contact.id}`}>
                        {getAccountName(contact.accountId)}
                      </TableCell>
                    )}
                    {isColumnVisible("title") && (
                      <TableCell data-testid={`cell-title-${contact.id}`}>
                        {contact.title || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("ownerId") && (
                      <TableCell data-testid={`cell-owner-${contact.id}`}>
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
    </div>
  );
}
