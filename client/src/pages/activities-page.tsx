// Activities page with timeline view
// Based on design_guidelines.md enterprise SaaS patterns

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Loader2, Calendar, Phone, Mail, MessageSquare, CheckSquare, FileText, Download, Filter, SortAsc, Eye, X } from "lucide-react";
import { Activity, InsertActivity, insertActivitySchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AssociationManager, Association } from "@/components/association-manager";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ActivitiesSummaryCards } from "@/components/activities-summary-cards";

const activityIcons = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  task: CheckSquare,
  note: FileText,
};

interface Filters {
  type: string[];
  status: string[];
  priority: string[];
  dateFrom: string;
  dateTo: string;
}

interface SortConfig {
  field: keyof Activity | null;
  direction: "asc" | "desc";
}

export default function ActivitiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [associations, setAssociations] = useState<Association[]>([]);
  
  // Bulk operations state
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(new Set());
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [isChangeDueDateDialogOpen, setIsChangeDueDateDialogOpen] = useState(false);
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkDueDate, setBulkDueDate] = useState("");
  
  // Filter and sort state
  const [filters, setFilters] = useState<Filters>({
    type: [],
    status: [],
    priority: [],
    dateFrom: "",
    dateTo: "",
  });
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: "createdAt", direction: "desc" });
  const [visibleColumns, setVisibleColumns] = useState({
    type: true,
    status: true,
    priority: true,
    dueDate: true,
    owner: true,
    notes: true,
  });

  const { data: activities, isLoading } = useQuery<Activity[]>({
    queryKey: ["/api/activities"],
  });

  const { data: users = [] } = useQuery<Array<{ id: string; name: string; email: string }>>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertActivity) => {
      const res = await apiRequest("POST", "/api/activities", data);
      return await res.json();
    },
    onSuccess: async (createdActivity) => {
      // Create associations after activity is created
      for (const association of associations) {
        try {
          await apiRequest("POST", `/api/activities/${createdActivity.id}/associations`, {
            entityType: association.entityType,
            entityId: association.entityId,
          });
        } catch (error) {
          console.error("Failed to create association:", error);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities/summary"] });
      toast({ title: "Activity created successfully" });
      setIsCreateDialogOpen(false);
      setAssociations([]);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create activity", description: error.message, variant: "destructive" });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ activityIds, updates }: { activityIds: string[]; updates: any }) => {
      const res = await apiRequest("PATCH", "/api/activities/bulk-update", { activityIds, updates });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities/summary"] });
      toast({ title: `Successfully updated ${data.updated} activities` });
      setSelectedActivityIds(new Set());
      setIsReassignDialogOpen(false);
      setIsChangeDueDateDialogOpen(false);
      setBulkOwnerId("");
      setBulkDueDate("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to bulk update activities", description: error.message, variant: "destructive" });
    },
  });

  // Bulk selection helpers
  const toggleActivitySelection = (activityId: string) => {
    const newSelection = new Set(selectedActivityIds);
    if (newSelection.has(activityId)) {
      newSelection.delete(activityId);
    } else {
      newSelection.add(activityId);
    }
    setSelectedActivityIds(newSelection);
  };

  const selectAllActivities = () => {
    if (filteredAndSortedActivities) {
      setSelectedActivityIds(new Set(filteredAndSortedActivities.map(a => a.id)));
    }
  };

  const clearSelection = () => {
    setSelectedActivityIds(new Set());
  };

  const handleBulkReassign = () => {
    if (!bulkOwnerId) {
      toast({ title: "Please select an owner", variant: "destructive" });
      return;
    }
    bulkUpdateMutation.mutate({
      activityIds: Array.from(selectedActivityIds),
      updates: { ownerId: bulkOwnerId },
    });
  };

  const handleBulkChangeDueDate = () => {
    console.log("Bulk due date value:", bulkDueDate, "Type:", typeof bulkDueDate, "Length:", bulkDueDate?.length);
    if (!bulkDueDate || bulkDueDate.trim() === "") {
      console.log("Validation failed - no due date selected");
      toast({ title: "Please select a due date", variant: "destructive" });
      return;
    }
    console.log("Submitting bulk update with dueAt:", bulkDueDate);
    bulkUpdateMutation.mutate({
      activityIds: Array.from(selectedActivityIds),
      updates: { dueAt: bulkDueDate },
    });
  };

  const form = useForm<InsertActivity>({
    resolver: zodResolver(insertActivitySchema),
    defaultValues: {
      id: "",
      type: "call",
      subject: "",
      status: "pending",
      priority: "medium",
      dueAt: null,
      completedAt: null,
      ownerId: user?.id || "",
      relatedType: "",
      relatedId: "",
      notes: "",
    },
  });

  const onSubmit = (data: InsertActivity) => {
    createMutation.mutate(data);
  };

  // Filter and sort activities
  const filteredAndSortedActivities = useMemo(() => {
    if (!activities) return [];

    let filtered = activities.filter((activity) => {
      // Type filter
      if (filters.type.length > 0 && !filters.type.includes(activity.type)) {
        return false;
      }
      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(activity.status)) {
        return false;
      }
      // Priority filter
      if (filters.priority.length > 0 && !filters.priority.includes(activity.priority)) {
        return false;
      }
      // Date filter
      if (filters.dateFrom && activity.dueAt && new Date(activity.dueAt) < new Date(filters.dateFrom)) {
        return false;
      }
      if (filters.dateTo && activity.dueAt && new Date(activity.dueAt) > new Date(filters.dateTo)) {
        return false;
      }
      return true;
    });

    // Sort
    if (sortConfig.field) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortConfig.field!];
        const bVal = b[sortConfig.field!];
        
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        
        let comparison = 0;
        if (typeof aVal === "string" && typeof bVal === "string") {
          comparison = aVal.localeCompare(bVal);
        } else if (aVal instanceof Date && bVal instanceof Date) {
          comparison = aVal.getTime() - bVal.getTime();
        } else if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal;
        } else {
          comparison = String(aVal).localeCompare(String(bVal));
        }
        
        return sortConfig.direction === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [activities, filters, sortConfig]);

  const toggleFilter = (filterType: keyof Omit<Filters, "dateFrom" | "dateTo">, value: string) => {
    setFilters((prev) => {
      const currentValues = prev[filterType];
      const newValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      return { ...prev, [filterType]: newValues };
    });
  };

  const toggleSort = (field: keyof Activity) => {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const clearFilters = () => {
    setFilters({
      type: [],
      status: [],
      priority: [],
      dateFrom: "",
      dateTo: "",
    });
  };

  const hasActiveFilters = filters.type.length > 0 || filters.status.length > 0 || filters.priority.length > 0 || filters.dateFrom || filters.dateTo;

  const handleExport = async () => {
    try {
      const response = await fetch("/api/export/activities", {
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error("Export failed");
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activities-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Activities exported successfully" });
    } catch (error) {
      toast({ title: "Failed to export Activities", variant: "destructive" });
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-foreground">Activities</h1>
          <p className="text-muted-foreground">Track calls, meetings, tasks, and notes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} data-testid="button-export-activities">
            <Download className="h-4 w-4 mr-2" />
            Export to CSV
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-activity">
                <Plus className="h-4 w-4 mr-2" />
                New Activity
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Activity</DialogTitle>
              <DialogDescription>Add a new activity to track your interactions</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Activity ID</FormLabel>
                      <FormControl>
                        <Input placeholder="Will be auto-generated if left blank" {...field} data-testid="input-activity-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-activity-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="call">Call</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="meeting">Meeting</SelectItem>
                          <SelectItem value="task">Task</SelectItem>
                          <SelectItem value="note">Note</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subject *</FormLabel>
                      <FormControl>
                        <Input placeholder="Follow-up call with client" {...field} data-testid="input-activity-subject" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-activity-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-activity-priority">
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="dueAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due Date</FormLabel>
                        <FormControl>
                          <Input 
                            type="datetime-local" 
                            {...field} 
                            value={field.value ? new Date(field.value).toISOString().slice(0, 16) : ""}
                            onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
                            data-testid="input-activity-due-date" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="ownerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Owner *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger data-testid="select-activity-owner">
                              <SelectValue placeholder="Select owner" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {users.map((user) => (
                              <SelectItem key={user.id} value={user.id}>
                                {user.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="relatedType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Related To</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger data-testid="select-related-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Account">Account</SelectItem>
                            <SelectItem value="Contact">Contact</SelectItem>
                            <SelectItem value="Lead">Lead</SelectItem>
                            <SelectItem value="Opportunity">Opportunity</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="relatedId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Related ID</FormLabel>
                        <FormControl>
                          <Input placeholder="ACCT-2025-00001" {...field} value={field.value || ""} data-testid="input-related-id" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Add additional details..." {...field} value={field.value || ""} data-testid="input-activity-notes" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <AssociationManager
                  associations={associations}
                  onChange={setAssociations}
                  className="mt-4"
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-activity">
                    {createMutation.isPending ? "Creating..." : "Create Activity"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectedActivityIds.size > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">
                {selectedActivityIds.size} {selectedActivityIds.size === 1 ? 'activity' : 'activities'} selected
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllActivities}
                  data-testid="button-select-all"
                >
                  Select All ({filteredAndSortedActivities?.length || 0})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  data-testid="button-clear-selection"
                >
                  Clear Selection
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsReassignDialogOpen(true)}
                data-testid="button-bulk-reassign"
              >
                Reassign Owner
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsChangeDueDateDialogOpen(true)}
                data-testid="button-bulk-change-due-date"
              >
                Change Due Date
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Statistics */}
      <ActivitiesSummaryCards />

      {/* Filter, Sort, and Column Controls */}
      <div className="flex gap-2 flex-wrap">
        {/* Filter Controls */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-filter">
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasActiveFilters && <Badge variant="secondary" className="ml-2">{filters.type.length + filters.status.length + filters.priority.length}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-2">Type</h4>
                <div className="flex flex-wrap gap-2">
                  {["call", "email", "meeting", "task", "note"].map((type) => (
                    <Button
                      key={type}
                      variant={filters.type.includes(type) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilter("type", type)}
                      data-testid={`filter-type-${type}`}
                    >
                      {type}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-medium text-sm mb-2">Status</h4>
                <div className="flex flex-wrap gap-2">
                  {["pending", "completed", "cancelled"].map((status) => (
                    <Button
                      key={status}
                      variant={filters.status.includes(status) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilter("status", status)}
                      data-testid={`filter-status-${status}`}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-medium text-sm mb-2">Priority</h4>
                <div className="flex flex-wrap gap-2">
                  {["low", "medium", "high"].map((priority) => (
                    <Button
                      key={priority}
                      variant={filters.priority.includes(priority) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFilter("priority", priority)}
                      data-testid={`filter-priority-${priority}`}
                    >
                      {priority}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateFrom">Due Date From</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                  data-testid="filter-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateTo">Due Date To</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                  data-testid="filter-date-to"
                />
              </div>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="w-full" data-testid="button-clear-filters">
                  <X className="h-4 w-4 mr-2" />
                  Clear All Filters
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Sort Controls */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-sort">
              <SortAsc className="h-4 w-4 mr-2" />
              Sort{sortConfig.field && `: ${sortConfig.field}`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56">
            <div className="space-y-2">
              <h4 className="font-medium text-sm mb-2">Sort By</h4>
              {["subject", "type", "status", "priority", "dueAt", "createdAt"].map((field) => (
                <Button
                  key={field}
                  variant={sortConfig.field === field ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSort(field as keyof Activity)}
                  className="w-full justify-start"
                  data-testid={`sort-${field}`}
                >
                  {field} {sortConfig.field === field && (sortConfig.direction === "asc" ? "↑" : "↓")}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Column Visibility Controls */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="button-columns">
              <Eye className="h-4 w-4 mr-2" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56">
            <div className="space-y-2">
              <h4 className="font-medium text-sm mb-2">Show Columns</h4>
              {Object.entries(visibleColumns).map(([column, visible]) => (
                <div key={column} className="flex items-center space-x-2">
                  <Checkbox
                    id={column}
                    checked={visible}
                    onCheckedChange={(checked) =>
                      setVisibleColumns((prev) => ({ ...prev, [column]: !!checked }))
                    }
                    data-testid={`column-${column}`}
                  />
                  <Label htmlFor={column} className="capitalize cursor-pointer">{column}</Label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Activity Timeline ({filteredAndSortedActivities.length} of {activities?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredAndSortedActivities && filteredAndSortedActivities.length > 0 ? (
            <div className="space-y-4">
              {filteredAndSortedActivities.map((activity) => {
                const Icon = activityIcons[activity.type];
                const isSelected = selectedActivityIds.has(activity.id);
                return (
                  <Card 
                    key={activity.id} 
                    className={`p-4 ${isSelected ? 'border-primary bg-primary/5' : ''}`}
                    data-testid={`card-activity-${activity.id}`}
                  >
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleActivitySelection(activity.id)}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`checkbox-activity-${activity.id}`}
                        />
                        <div 
                          className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center cursor-pointer hover-elevate active-elevate-2"
                          onClick={() => setLocation(`/activities/${activity.id}`)}
                        >
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-medium">{activity.subject}</h4>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {visibleColumns.type && <Badge variant="outline" className="capitalize">{activity.type}</Badge>}
                              {visibleColumns.status && <Badge variant="outline" className="capitalize">{activity.status}</Badge>}
                              {visibleColumns.priority && <Badge variant="outline" className="capitalize">{activity.priority}</Badge>}
                              {visibleColumns.dueDate && activity.dueAt && (
                                <span className="text-xs text-muted-foreground">
                                  Due: {new Date(activity.dueAt).toLocaleDateString()}
                                </span>
                              )}
                              {activity.relatedType && (
                                <span className="text-xs text-muted-foreground">
                                  Related to: {activity.relatedType} {activity.relatedId}
                                </span>
                              )}
                              {visibleColumns.owner && activity.ownerId && (
                                <span className="text-xs text-muted-foreground">
                                  Owner: {users.find(u => u.id === activity.ownerId)?.name || "Unknown"}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(activity.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        {visibleColumns.notes && activity.notes && (
                          <p className="text-sm text-muted-foreground mt-2">{activity.notes}</p>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No activities found. Create your first activity to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reassign Owner Dialog */}
      <Dialog open={isReassignDialogOpen} onOpenChange={setIsReassignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign Owner</DialogTitle>
            <DialogDescription>
              Assign the selected {selectedActivityIds.size} {selectedActivityIds.size === 1 ? 'activity' : 'activities'} to a new owner
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-owner">New Owner</Label>
              <Select value={bulkOwnerId} onValueChange={setBulkOwnerId}>
                <SelectTrigger id="bulk-owner" data-testid="select-bulk-owner">
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReassignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkReassign}
              disabled={bulkUpdateMutation.isPending}
              data-testid="button-confirm-bulk-reassign"
            >
              {bulkUpdateMutation.isPending ? "Reassigning..." : "Reassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Due Date Dialog */}
      <Dialog open={isChangeDueDateDialogOpen} onOpenChange={setIsChangeDueDateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Due Date</DialogTitle>
            <DialogDescription>
              Set a new due date for the selected {selectedActivityIds.size} {selectedActivityIds.size === 1 ? 'activity' : 'activities'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-due-date">New Due Date</Label>
              <Input
                id="bulk-due-date"
                type="date"
                value={bulkDueDate}
                onChange={(e) => setBulkDueDate(e.target.value)}
                data-testid="input-bulk-due-date"
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsChangeDueDateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkChangeDueDate}
              disabled={bulkUpdateMutation.isPending}
              data-testid="button-confirm-bulk-due-date"
            >
              {bulkUpdateMutation.isPending ? "Updating..." : "Update Due Date"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
