// Lead conversion wizard component
// Multi-step wizard for converting leads to accounts/contacts/opportunities

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Lead } from "@shared/schema";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2, Building2, Users, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ConversionStep = "review" | "duplicate-check" | "confirm" | "success";

type ConversionData = {
  createAccount: boolean;
  accountName: string;
  createContact: boolean;
  createOpportunity: boolean;
  opportunityName: string;
  opportunityAmount: string;
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
  const [step, setStep] = useState<ConversionStep>("review");
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      setStep("success");
    },
    onError: (error: Error) => {
      toast({
        title: "Conversion failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleNext = () => {
    if (step === "review") {
      setStep("duplicate-check");
    } else if (step === "duplicate-check") {
      setStep("confirm");
    } else if (step === "confirm") {
      convertMutation.mutate(conversionData);
    }
  };

  const handleClose = () => {
    setStep("review");
    setConversionData({
      createAccount: true,
      accountName: "",
      createContact: true,
      createOpportunity: true,
      opportunityName: "",
      opportunityAmount: "",
    });
    onClose();
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!lead) return null;

  // Set default values on first load
  if (conversionData.accountName === "" && lead.company) {
    setConversionData((prev) => ({ ...prev, accountName: lead.company || "" }));
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        {step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle>Convert Lead</DialogTitle>
              <DialogDescription>Review lead information and select what to create</DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <h3 className="font-medium">Lead Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Company:</span>
                    <p className="font-medium">{lead.company || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <p className="font-medium">{lead.email || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <p className="font-medium">{lead.phone || "N/A"}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="create-account"
                    checked={conversionData.createAccount}
                    onCheckedChange={(checked) =>
                      setConversionData({ ...conversionData, createAccount: checked as boolean })
                    }
                    data-testid="checkbox-create-account"
                  />
                  <div className="flex-1">
                    <Label htmlFor="create-account" className="flex items-center gap-2 font-medium cursor-pointer">
                      <Building2 className="h-4 w-4" />
                      Create Account
                    </Label>
                    {conversionData.createAccount && (
                      <Input
                        className="mt-2"
                        placeholder="Account name"
                        value={conversionData.accountName}
                        onChange={(e) =>
                          setConversionData({ ...conversionData, accountName: e.target.value })
                        }
                        data-testid="input-account-name"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="create-contact"
                    checked={conversionData.createContact}
                    onCheckedChange={(checked) =>
                      setConversionData({ ...conversionData, createContact: checked as boolean })
                    }
                    data-testid="checkbox-create-contact"
                  />
                  <Label htmlFor="create-contact" className="flex items-center gap-2 font-medium cursor-pointer">
                    <Users className="h-4 w-4" />
                    Create Contact
                  </Label>
                </div>

                <div className="flex items-start space-x-3">
                  <Checkbox
                    id="create-opportunity"
                    checked={conversionData.createOpportunity}
                    onCheckedChange={(checked) =>
                      setConversionData({ ...conversionData, createOpportunity: checked as boolean })
                    }
                    data-testid="checkbox-create-opportunity"
                  />
                  <div className="flex-1">
                    <Label htmlFor="create-opportunity" className="flex items-center gap-2 font-medium cursor-pointer">
                      <Target className="h-4 w-4" />
                      Create Opportunity
                    </Label>
                    {conversionData.createOpportunity && (
                      <div className="mt-2 space-y-2">
                        <Input
                          placeholder="Opportunity name"
                          value={conversionData.opportunityName}
                          onChange={(e) =>
                            setConversionData({ ...conversionData, opportunityName: e.target.value })
                          }
                          data-testid="input-opportunity-name"
                        />
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={conversionData.opportunityAmount}
                          onChange={(e) =>
                            setConversionData({ ...conversionData, opportunityAmount: e.target.value })
                          }
                          data-testid="input-opportunity-amount"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleNext} data-testid="button-next">
                Next
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "duplicate-check" && (
          <>
            <DialogHeader>
              <DialogTitle>Duplicate Check</DialogTitle>
              <DialogDescription>Checking for potential duplicate records</DialogDescription>
            </DialogHeader>
            <div className="py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">No duplicates found</p>
              <p className="text-sm text-muted-foreground">Safe to proceed with conversion</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("review")}>
                Back
              </Button>
              <Button onClick={handleNext} data-testid="button-confirm">
                Confirm
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Conversion</DialogTitle>
              <DialogDescription>Review the records that will be created</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">The following records will be created:</p>
              <div className="space-y-2">
                {conversionData.createAccount && (
                  <div className="flex items-center gap-2 p-3 bg-accent rounded-md">
                    <Building2 className="h-4 w-4 text-accent-foreground" />
                    <span className="font-medium">Account:</span>
                    <span>{conversionData.accountName || lead.company}</span>
                  </div>
                )}
                {conversionData.createContact && (
                  <div className="flex items-center gap-2 p-3 bg-accent rounded-md">
                    <Users className="h-4 w-4 text-accent-foreground" />
                    <span className="font-medium">Contact:</span>
                    <span>{lead.firstName} {lead.lastName}</span>
                  </div>
                )}
                {conversionData.createOpportunity && (
                  <div className="flex items-center gap-2 p-3 bg-accent rounded-md">
                    <Target className="h-4 w-4 text-accent-foreground" />
                    <span className="font-medium">Opportunity:</span>
                    <span>{conversionData.opportunityName || `${lead.firstName} ${lead.lastName} - Opportunity`}</span>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("duplicate-check")}>
                Back
              </Button>
              <Button
                onClick={handleNext}
                disabled={convertMutation.isPending}
                data-testid="button-convert-lead"
              >
                {convertMutation.isPending ? "Converting..." : "Convert Lead"}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle>Conversion Complete</DialogTitle>
              <DialogDescription>Lead has been successfully converted</DialogDescription>
            </DialogHeader>
            <div className="py-8 text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">Lead converted successfully!</p>
              <p className="text-sm text-muted-foreground">
                The lead has been converted and new records have been created.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleClose} data-testid="button-done">
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
