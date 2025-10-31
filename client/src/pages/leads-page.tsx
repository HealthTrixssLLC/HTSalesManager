// Leads list page with conversion wizard
// Based on design_guidelines.md enterprise SaaS patterns

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Loader2, UserPlus, ArrowRightCircle, Download } from "lucide-react";
import { Lead, InsertLead, insertLeadSchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const statusColors: Record<string, string> = {
  new: "bg-blue-500",
  contacted: "bg-yellow-500",
  qualified: "bg-green-500",
  unqualified: "bg-gray-500",
  converted: "bg-primary",
};

export default function LeadsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const { data: leads, isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
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
      toast({ title: "Failed to export Leads", variant: "destructive" });
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
          <h1 className="text-3xl font-semibold text-foreground">Leads</h1>
          <p className="text-muted-foreground">Capture and convert leads into opportunities</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} data-testid="button-export-leads">
            <Download className="h-4 w-4 mr-2" />
            Export to CSV
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            All Leads ({leads?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leads && leads.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                    <TableCell className="font-mono text-sm">{lead.id}</TableCell>
                    <TableCell className="font-medium">{lead.firstName} {lead.lastName}</TableCell>
                    <TableCell>{lead.company || "-"}</TableCell>
                    <TableCell className="text-sm">{lead.email || "-"}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[lead.status]}>
                        {lead.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{lead.source || "-"}</TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No leads found. Create your first lead to get started.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedLeadId && (
        <LeadConversionWizard
          leadId={selectedLeadId}
          open={!!selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
    </div>
  );
}
