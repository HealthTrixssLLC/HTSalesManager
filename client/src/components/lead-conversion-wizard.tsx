import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Lead } from "@shared/schema";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, CheckCircle2, Building2, Users, Target, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

type ConversionData = {
  createAccount: boolean;
  accountName: string;
  createContact: boolean;
  createOpportunity: boolean;
  opportunityName: string;
  opportunityAmount: string;
};

type ConversionResult = {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
};

export function LeadConversionWizard({
  leadId,
  open,
  onClose,
}: {
  leadId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult>({});
  const [accountOpen, setAccountOpen] = useState(true);
  const [contactOpen, setContactOpen] = useState(true);
  const [opportunityOpen, setOpportunityOpen] = useState(true);
  const [conversionData, setConversionData] = useState<ConversionData>({
    createAccount: true,
    accountName: "",
    createContact: true,
    createOpportunity: true,
    opportunityName: "",
    opportunityAmount: "",
  });

  const { data: lead, isLoading } = useQuery<Lead>({
    queryKey: [`/api/leads/${leadId}`],
    enabled: !!leadId && open,
  });

  const convertMutation = useMutation({
    mutationFn: async (data: ConversionData) => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/convert`, data);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      setConversionResult({
        accountId: data?.accountId || data?.account?.id,
        contactId: data?.contactId || data?.contact?.id,
        opportunityId: data?.opportunityId || data?.opportunity?.id,
      });
      setIsSuccess(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Conversion failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    setIsSuccess(false);
    setConversionResult({});
    setConversionData({
      createAccount: true,
      accountName: "",
      createContact: true,
      createOpportunity: true,
      opportunityName: "",
      opportunityAmount: "",
    });
    setAccountOpen(true);
    setContactOpen(true);
    setOpportunityOpen(true);
    onClose();
  };

  const handleConvert = () => {
    convertMutation.mutate(conversionData);
  };

  useEffect(() => {
    if (lead && lead.company && conversionData.accountName === "") {
      setConversionData((prev) => ({ ...prev, accountName: lead.company || "" }));
    }
  }, [lead]);

  const atLeastOneSelected = conversionData.createAccount || conversionData.createContact || conversionData.createOpportunity;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : isSuccess ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="rounded-full p-3 mb-4" style={{ backgroundColor: "hsl(142, 40%, 92%)" }}>
              <CheckCircle2 className="h-10 w-10" style={{ color: "hsl(142, 50%, 36%)" }} />
            </div>
            <h2 className="text-xl font-semibold mb-2">Lead Converted</h2>
            <p className="text-sm text-muted-foreground mb-6">
              The lead has been successfully converted. View the created records below.
            </p>
            <div className="w-full space-y-2 mb-6">
              {conversionResult.accountId && (
                <Link href={`/accounts/${conversionResult.accountId}`}>
                  <div className="flex items-center gap-3 p-3 rounded-md border hover-elevate cursor-pointer" data-testid="link-created-account">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(216, 40%, 92%)" }}>
                      <Building2 className="h-4 w-4" style={{ color: "hsl(216, 40%, 30%)" }} />
                    </div>
                    <span className="flex-1 text-sm font-medium text-left">View Account</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              )}
              {conversionResult.contactId && (
                <Link href={`/contacts/${conversionResult.contactId}`}>
                  <div className="flex items-center gap-3 p-3 rounded-md border hover-elevate cursor-pointer" data-testid="link-created-contact">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(195, 45%, 90%)" }}>
                      <Users className="h-4 w-4" style={{ color: "hsl(195, 57%, 37%)" }} />
                    </div>
                    <span className="flex-1 text-sm font-medium text-left">View Contact</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              )}
              {conversionResult.opportunityId && (
                <Link href={`/opportunities/${conversionResult.opportunityId}`}>
                  <div className="flex items-center gap-3 p-3 rounded-md border hover-elevate cursor-pointer" data-testid="link-created-opportunity">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(142, 40%, 90%)" }}>
                      <Target className="h-4 w-4" style={{ color: "hsl(142, 50%, 36%)" }} />
                    </div>
                    <span className="flex-1 text-sm font-medium text-left">View Opportunity</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </Link>
              )}
            </div>
            <Button onClick={handleClose} data-testid="button-conversion-done">
              Done
            </Button>
          </div>
        ) : lead ? (
          <>
            <SheetHeader>
              <SheetTitle>Convert Lead</SheetTitle>
              <SheetDescription>
                Convert {lead.firstName} {lead.lastName} to CRM records
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="rounded-md border p-4 space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Lead Summary</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name</span>
                    <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Company</span>
                    <p className="font-medium">{lead.company || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email</span>
                    <p className="font-medium">{lead.email || "—"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone</span>
                    <p className="font-medium">{lead.phone || "—"}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Create Records</h3>

                <Collapsible open={accountOpen} onOpenChange={setAccountOpen}>
                  <div className="rounded-md border">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md" data-testid="collapsible-account">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(216, 40%, 92%)" }}>
                            <Building2 className="h-4 w-4" style={{ color: "hsl(216, 40%, 30%)" }} />
                          </div>
                          <div>
                            <Label className="font-medium cursor-pointer">Account</Label>
                            <p className="text-xs text-muted-foreground">Create a new account record</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={conversionData.createAccount}
                            onCheckedChange={(checked) => {
                              setConversionData({ ...conversionData, createAccount: checked });
                              if (checked) setAccountOpen(true);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid="switch-create-account"
                          />
                          {accountOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {conversionData.createAccount && (
                        <div className="px-4 pb-4 pt-1">
                          <Label className="text-xs text-muted-foreground">Account Name</Label>
                          <Input
                            className="mt-1"
                            value={conversionData.accountName}
                            onChange={(e) => setConversionData({ ...conversionData, accountName: e.target.value })}
                            placeholder="Account name"
                            data-testid="input-conversion-account-name"
                          />
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                <Collapsible open={contactOpen} onOpenChange={setContactOpen}>
                  <div className="rounded-md border">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md" data-testid="collapsible-contact">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(195, 45%, 90%)" }}>
                            <Users className="h-4 w-4" style={{ color: "hsl(195, 57%, 37%)" }} />
                          </div>
                          <div>
                            <Label className="font-medium cursor-pointer">Contact</Label>
                            <p className="text-xs text-muted-foreground">{lead.firstName} {lead.lastName}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={conversionData.createContact}
                            onCheckedChange={(checked) => {
                              setConversionData({ ...conversionData, createContact: checked });
                              if (checked) setContactOpen(true);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid="switch-create-contact"
                          />
                          {contactOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {conversionData.createContact && (
                        <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground">
                          Contact will be created from lead details: {lead.firstName} {lead.lastName}
                          {lead.email && ` (${lead.email})`}
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>

                <Collapsible open={opportunityOpen} onOpenChange={setOpportunityOpen}>
                  <div className="rounded-md border">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between gap-3 p-4 cursor-pointer hover-elevate rounded-md" data-testid="collapsible-opportunity">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center justify-center h-8 w-8 rounded-md" style={{ backgroundColor: "hsl(142, 40%, 90%)" }}>
                            <Target className="h-4 w-4" style={{ color: "hsl(142, 50%, 36%)" }} />
                          </div>
                          <div>
                            <Label className="font-medium cursor-pointer">Opportunity</Label>
                            <p className="text-xs text-muted-foreground">Create a new opportunity</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={conversionData.createOpportunity}
                            onCheckedChange={(checked) => {
                              setConversionData({ ...conversionData, createOpportunity: checked });
                              if (checked) setOpportunityOpen(true);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            data-testid="switch-create-opportunity"
                          />
                          {opportunityOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {conversionData.createOpportunity && (
                        <div className="px-4 pb-4 pt-1 space-y-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Opportunity Name</Label>
                            <Input
                              className="mt-1"
                              value={conversionData.opportunityName}
                              onChange={(e) => setConversionData({ ...conversionData, opportunityName: e.target.value })}
                              placeholder={`${lead.firstName} ${lead.lastName} - Opportunity`}
                              data-testid="input-conversion-opp-name"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Amount</Label>
                            <Input
                              type="number"
                              className="mt-1"
                              value={conversionData.opportunityAmount}
                              onChange={(e) => setConversionData({ ...conversionData, opportunityAmount: e.target.value })}
                              placeholder="0"
                              data-testid="input-conversion-opp-amount"
                            />
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConvert}
                  disabled={!atLeastOneSelected || convertMutation.isPending}
                  data-testid="button-convert-lead-submit"
                >
                  {convertMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Converting...
                    </>
                  ) : (
                    <>
                      Convert Lead
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
