import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, Users, UserPlus, Target, Calendar, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const entityTabs = [
  { value: "account", label: "Account", icon: Building2 },
  { value: "contact", label: "Contact", icon: Users },
  { value: "lead", label: "Lead", icon: UserPlus },
  { value: "opportunity", label: "Opportunity", icon: Target },
  { value: "activity", label: "Activity", icon: Calendar },
] as const;

type EntityTab = typeof entityTabs[number]["value"];

const routeMap: Record<EntityTab, string> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  activity: "activities",
};

export interface QuickAddContext {
  accountId?: string;
  accountName?: string;
  contactId?: string;
  contactName?: string;
  leadId?: string;
  opportunityId?: string;
}

interface GlobalQuickAddProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: EntityTab;
  context?: QuickAddContext;
}

export function GlobalQuickAdd({ open, onOpenChange, defaultTab = "lead", context }: GlobalQuickAddProps) {
  const [activeTab, setActiveTab] = useState<EntityTab>(defaultTab);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (open && defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [open, defaultTab]);

  const handleSuccess = (tab: EntityTab, id: string) => {
    const label = entityTabs.find((t) => t.value === tab)?.label || tab;
    toast({ title: `${label} created successfully` });
    onOpenChange(false);
    setLocation(`/${routeMap[tab]}/${id}`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Quick Add
          </SheetTitle>
          <SheetDescription>Create a new record</SheetDescription>
        </SheetHeader>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as EntityTab)} className="mt-4">
          <TabsList className="w-full grid grid-cols-5">
            {entityTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="text-xs gap-1" data-testid={`tab-quick-add-${tab.value}`}>
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="account" className="mt-4">
            <QuickAddAccount onSuccess={(id) => handleSuccess("account", id)} onCancel={() => onOpenChange(false)} />
          </TabsContent>
          <TabsContent value="contact" className="mt-4">
            <QuickAddContact onSuccess={(id) => handleSuccess("contact", id)} onCancel={() => onOpenChange(false)} context={context} />
          </TabsContent>
          <TabsContent value="lead" className="mt-4">
            <QuickAddLead onSuccess={(id) => handleSuccess("lead", id)} onCancel={() => onOpenChange(false)} context={context} />
          </TabsContent>
          <TabsContent value="opportunity" className="mt-4">
            <QuickAddOpportunity onSuccess={(id) => handleSuccess("opportunity", id)} onCancel={() => onOpenChange(false)} context={context} />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <QuickAddActivity onSuccess={(id) => handleSuccess("activity", id)} onCancel={() => onOpenChange(false)} context={context} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function QuickAddAccount({ onSuccess, onCancel }: { onSuccess: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("customer");
  const [industry, setIndustry] = useState("");
  const [phone, setPhone] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/accounts", { id: "", name, type, industry: industry || null, phone: phone || null });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      onSuccess(data.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create account", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Account Name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Healthcare" className="mt-1.5" data-testid="input-quick-account-name" />
      </div>
      <div>
        <Label>Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="mt-1.5" data-testid="select-quick-account-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Industry</Label>
        <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Healthcare" className="mt-1.5" data-testid="input-quick-account-industry" />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" className="mt-1.5" data-testid="input-quick-account-phone" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending} data-testid="button-quick-create-account">
          {mutation.isPending ? "Creating..." : "Create Account"}
        </Button>
      </div>
    </div>
  );
}

function QuickAddContact({ onSuccess, onCancel, context }: { onSuccess: (id: string) => void; onCancel: () => void; context?: QuickAddContext }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accountId, setAccountId] = useState(context?.accountId || "");
  const { toast } = useToast();

  const { data: accounts } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/accounts"],
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contacts", {
        id: "",
        firstName, lastName,
        email: email || null,
        phone: phone || null,
        accountId: accountId || null,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (accountId) queryClient.invalidateQueries({ queryKey: ["/api/accounts", accountId] });
      onSuccess(data.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create contact", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First Name *</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" className="mt-1.5" data-testid="input-quick-contact-first" />
        </div>
        <div>
          <Label>Last Name *</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" className="mt-1.5" data-testid="input-quick-contact-last" />
        </div>
      </div>
      <div>
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@example.com" className="mt-1.5" data-testid="input-quick-contact-email" />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" className="mt-1.5" data-testid="input-quick-contact-phone" />
      </div>
      <div>
        <Label>Account</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="mt-1.5" data-testid="select-quick-contact-account">
            <SelectValue placeholder="Select account (optional)" />
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!firstName.trim() || !lastName.trim() || mutation.isPending} data-testid="button-quick-create-contact">
          {mutation.isPending ? "Creating..." : "Create Contact"}
        </Button>
      </div>
    </div>
  );
}

function QuickAddLead({ onSuccess, onCancel, context }: { onSuccess: (id: string) => void; onCancel: () => void; context?: QuickAddContext }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState(context?.accountName || "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState<string>("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads", {
        id: "",
        firstName, lastName, company: company || null, email: email || null,
        phone: phone || null,
        status: "new", rating: rating || null,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onSuccess(data.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create lead", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>First Name *</Label>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" className="mt-1.5" data-testid="input-quick-lead-first" />
        </div>
        <div>
          <Label>Last Name *</Label>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" className="mt-1.5" data-testid="input-quick-lead-last" />
        </div>
      </div>
      <div>
        <Label>Company</Label>
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Healthcare Corp" className="mt-1.5" data-testid="input-quick-lead-company" />
      </div>
      <div>
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" className="mt-1.5" data-testid="input-quick-lead-email" />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" className="mt-1.5" data-testid="input-quick-lead-phone" />
      </div>
      <div>
        <Label>Rating</Label>
        <Select value={rating} onValueChange={setRating}>
          <SelectTrigger className="mt-1.5" data-testid="select-quick-lead-rating">
            <SelectValue placeholder="Select rating" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!firstName.trim() || !lastName.trim() || mutation.isPending} data-testid="button-quick-create-lead">
          {mutation.isPending ? "Creating..." : "Create Lead"}
        </Button>
      </div>
    </div>
  );
}

function QuickAddOpportunity({ onSuccess, onCancel, context }: { onSuccess: (id: string) => void; onCancel: () => void; context?: QuickAddContext }) {
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(context?.accountId || "");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("prospecting");
  const [closeDate, setCloseDate] = useState("");
  const { toast } = useToast();

  const { data: accounts } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/accounts"],
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/opportunities", {
        id: "",
        name, accountId, stage,
        amount: amount || "0",
        closeDate: closeDate ? new Date(closeDate) : new Date(),
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      if (accountId) queryClient.invalidateQueries({ queryKey: ["/api/accounts", accountId] });
      onSuccess(data.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create opportunity", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Opportunity Name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 Software License" className="mt-1.5" data-testid="input-quick-opp-name" />
      </div>
      <div>
        <Label>Account *</Label>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="mt-1.5" data-testid="select-quick-opp-account">
            <SelectValue placeholder="Select account" />
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Amount</Label>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" className="mt-1.5" data-testid="input-quick-opp-amount" />
        </div>
        <div>
          <Label>Stage</Label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="mt-1.5" data-testid="select-quick-opp-stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prospecting">Prospecting</SelectItem>
              <SelectItem value="qualification">Qualification</SelectItem>
              <SelectItem value="proposal">Proposal</SelectItem>
              <SelectItem value="negotiation">Negotiation</SelectItem>
              <SelectItem value="closed_won">Closed Won</SelectItem>
              <SelectItem value="closed_lost">Closed Lost</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Close Date</Label>
        <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="mt-1.5" data-testid="input-quick-opp-close-date" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!name.trim() || !accountId || mutation.isPending} data-testid="button-quick-create-opportunity">
          {mutation.isPending ? "Creating..." : "Create Opportunity"}
        </Button>
      </div>
    </div>
  );
}

function QuickAddActivity({ onSuccess, onCancel, context }: { onSuccess: (id: string) => void; onCancel: () => void; context?: QuickAddContext }) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("task");
  const [priority, setPriority] = useState("medium");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const relatedType = context?.accountId ? "Account" : context?.contactId ? "Contact" : context?.leadId ? "Lead" : context?.opportunityId ? "Opportunity" : undefined;
  const relatedId = context?.accountId || context?.contactId || context?.leadId || context?.opportunityId || undefined;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/activities", {
        id: "",
        subject, type, priority, status: "pending",
        dueAt: dueAt ? new Date(dueAt) : null,
        notes: notes || null,
        relatedType: relatedType || null,
        relatedId: relatedId || null,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      onSuccess(data.id);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create activity", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Subject *</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Follow up with client" className="mt-1.5" data-testid="input-quick-activity-subject" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="mt-1.5" data-testid="select-quick-activity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="task">Task</SelectItem>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="meeting">Meeting</SelectItem>
              <SelectItem value="note">Note</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="mt-1.5" data-testid="select-quick-activity-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Due Date</Label>
        <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1.5" data-testid="input-quick-activity-due" />
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes..." className="mt-1.5" rows={3} data-testid="textarea-quick-activity-notes" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!subject.trim() || mutation.isPending} data-testid="button-quick-create-activity">
          {mutation.isPending ? "Creating..." : "Create Activity"}
        </Button>
      </div>
    </div>
  );
}
