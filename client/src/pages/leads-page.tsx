// Leads list page with enhanced filtering, sorting, and column visibility
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, ArrowRightCircle, Download, MessageSquare, Mail, Phone } from "lucide-react";
import { Lead, InsertLead, insertLeadSchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LeadConversionWizard } from "@/components/lead-conversion-wizard";
import { CommentSystem } from "@/components/comment-system";
import { LeadsSummaryCards } from "@/components/leads-summary-cards";
import { LeadsFilterBar } from "@/components/leads-filter-bar";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { ColumnVisibility, type Column } from "@/components/column-visibility";

const statusColors: Record<string, string> = {
  new: "bg-blue-500",
  contacted: "bg-yellow-500",
  qualified: "bg-green-500",
  unqualified: "bg-gray-500",
  converted: "bg-primary",
};

// Define available columns
const AVAILABLE_COLUMNS: Column[] = [
  { id: "id", label: "ID" },
  { id: "name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "company", label: "Company" },
  { id: "status", label: "Status" },
  { id: "source", label: "Source" },
  { id: "rating", label: "Rating" },
  { id: "ownerId", label: "Owner" },
  { id: "topic", label: "Topic" },
  { id: "actions", label: "Actions" },
];

export default function LeadsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [commentsLeadId, setCommentsLeadId] = useState<string | null>(null);
  const [commentsLeadName, setCommentsLeadName] = useState<string | null>(null);

  // Filter and sort state
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    source: "",
    rating: "",
    ownerId: "",
  });
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.map(c => c.id)
  );

  // Build query string for API
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.search) params.append("search", filters.search);
    if (filters.status) params.append("status", filters.status);
    if (filters.source) params.append("source", filters.source);
    if (filters.rating) params.append("rating", filters.rating);
    if (filters.ownerId) params.append("ownerId", filters.ownerId);
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    return params.toString();
  }, [filters, sortBy, sortOrder]);

  // Fetch all leads (for total count)
  const { data: allLeads } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  // Fetch filtered leads
  const { data: filteredLeads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/leads?${queryString}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    },
  });

  const { data: users } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertLead) => {
      const res = await apiRequest("POST", "/api/leads", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead created successfully" });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create lead", description: error.message, variant: "destructive" });
    },
  });

  const form = useForm<InsertLead>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      id: "",
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      phone: "",
      topic: "",
      status: "new",
      source: "website",
      ownerId: user?.id || "",
    },
  });

  const onSubmit = (data: InsertLead) => {
    createMutation.mutate(data);
  };

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/leads", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Export failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Leads exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export leads", variant: "destructive" });
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
          <h1 className="text-3xl font-semibold text-foreground">Leads</h1>
          <p className="text-muted-foreground">Capture and convert leads into opportunities</p>
        </div>
        <div className="flex gap-2">
          <ColumnVisibility
            columns={AVAILABLE_COLUMNS.filter(c => c.id !== "actions")}
            storageKey="leads-visible-columns"
            onVisibilityChange={handleColumnVisibilityChange}
          />
          <Button variant="outline" onClick={handleExport} data-testid="button-export-leads">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-lead">
                <Plus className="h-4 w-4 mr-2" />
                New Lead
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Lead</DialogTitle>
              <DialogDescription>Add a new lead to your pipeline</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Will be auto-generated if left blank" {...field} data-testid="input-lead-id" />
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
                          <Input placeholder="John" {...field} data-testid="input-lead-first-name" />
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
                          <Input placeholder="Doe" {...field} data-testid="input-lead-last-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company</FormLabel>
                      <FormControl>
                        <Input placeholder="Acme Corp" {...field} value={field.value || ""} data-testid="input-lead-company" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="john@example.com" {...field} value={field.value || ""} data-testid="input-lead-email" />
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
                          <Input placeholder="+1 (555) 123-4567" {...field} value={field.value || ""} data-testid="input-lead-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="topic"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Topic</FormLabel>
                      <FormControl>
                        <Input placeholder="Lead topic or description" {...field} value={field.value || ""} data-testid="input-lead-topic" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-lead-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="qualified">Qualified</SelectItem>
                            <SelectItem value="unqualified">Unqualified</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="source"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger data-testid="select-lead-source">
                              <SelectValue placeholder="Select source" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="website">Website</SelectItem>
                            <SelectItem value="referral">Referral</SelectItem>
                            <SelectItem value="phone">Phone</SelectItem>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="event">Event</SelectItem>
                            <SelectItem value="partner">Partner</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="rating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rating</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger data-testid="select-lead-rating">
                            <SelectValue placeholder="Select rating" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="hot">Hot</SelectItem>
                          <SelectItem value="warm">Warm</SelectItem>
                          <SelectItem value="cold">Cold</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-lead">
                    {createMutation.isPending ? "Creating..." : "Create Lead"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      <LeadsSummaryCards />

      <LeadsFilterBar
        onFilterChange={handleFilterChange}
        totalCount={allLeads?.length || 0}
        filteredCount={filteredLeads?.length || 0}
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
                {isColumnVisible("company") && (
                  <SortableTableHeader
                    label="Company"
                    field="company"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("status") && (
                  <SortableTableHeader
                    label="Status"
                    field="status"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("source") && (
                  <SortableTableHeader
                    label="Source"
                    field="source"
                    currentSortBy={sortBy}
                    currentSortOrder={sortOrder}
                    onSort={handleSort}
                  />
                )}
                {isColumnVisible("rating") && (
                  <SortableTableHeader
                    label="Rating"
                    field="rating"
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
                {isColumnVisible("topic") && (
                  <SortableTableHeader
                    label="Topic"
                    field="topic"
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
              {filteredLeads?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={AVAILABLE_COLUMNS.length} className="text-center py-8 text-muted-foreground">
                    No leads found. {filters.search || filters.status || filters.source || filters.ownerId ? "Try adjusting your filters." : "Create your first lead to get started."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredLeads?.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer hover-elevate"
                    onClick={() => setLocation(`/leads/${lead.id}`)}
                    data-testid={`row-lead-${lead.id}`}
                  >
                    {isColumnVisible("id") && (
                      <TableCell className="font-medium" data-testid={`cell-id-${lead.id}`}>
                        {lead.id}
                      </TableCell>
                    )}
                    {isColumnVisible("name") && (
                      <TableCell className="font-medium" data-testid={`cell-name-${lead.id}`}>
                        {lead.firstName} {lead.lastName}
                      </TableCell>
                    )}
                    {isColumnVisible("email") && (
                      <TableCell onClick={(e) => e.stopPropagation()} data-testid={`cell-email-${lead.id}`}>
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`} className="text-primary hover:underline flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {lead.email}
                          </a>
                        ) : "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("phone") && (
                      <TableCell data-testid={`cell-phone-${lead.id}`}>
                        {lead.phone ? (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {lead.phone}
                          </span>
                        ) : "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("company") && (
                      <TableCell data-testid={`cell-company-${lead.id}`}>
                        {lead.company || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("status") && (
                      <TableCell data-testid={`cell-status-${lead.id}`}>
                        <Badge className={statusColors[lead.status]}>
                          {lead.status}
                        </Badge>
                      </TableCell>
                    )}
                    {isColumnVisible("source") && (
                      <TableCell className="capitalize" data-testid={`cell-source-${lead.id}`}>
                        {lead.source || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("rating") && (
                      <TableCell data-testid={`cell-rating-${lead.id}`}>
                        {lead.rating ? (
                          <Badge variant="outline" className="capitalize">
                            {lead.rating}
                          </Badge>
                        ) : "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("ownerId") && (
                      <TableCell data-testid={`cell-owner-${lead.id}`}>
                        {getOwnerName(lead.ownerId)}
                      </TableCell>
                    )}
                    {isColumnVisible("topic") && (
                      <TableCell data-testid={`cell-topic-${lead.id}`}>
                        {lead.topic || "-"}
                      </TableCell>
                    )}
                    {isColumnVisible("actions") && (
                      <TableCell onClick={(e) => e.stopPropagation()} className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={() => {
                              setCommentsLeadId(lead.id);
                              setCommentsLeadName(`${lead.firstName} ${lead.lastName}`);
                            }}
                            data-testid={`button-comments-${lead.id}`}
                          >
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                          {lead.status !== "converted" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedLeadId(lead.id)}
                              data-testid={`button-convert-${lead.id}`}
                            >
                              <ArrowRightCircle className="h-4 w-4 mr-1" />
                              Convert
                            </Button>
                          )}
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

      {selectedLeadId && (
        <LeadConversionWizard
          leadId={selectedLeadId}
          open={!!selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}

      <Dialog open={commentsLeadId !== null} onOpenChange={(open) => !open && setCommentsLeadId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comments</DialogTitle>
          </DialogHeader>
          {commentsLeadId && (
            <CommentSystem
              entity="leads"
              entityId={commentsLeadId}
              entityName={commentsLeadName || undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
