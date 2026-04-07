import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search, CheckCircle, ExternalLink, AlertTriangle, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ContactSuggestion {
  value: string;
  source: string;
}

interface ResearchResult {
  suggestions: Record<string, ContactSuggestion | null>;
  confidence: "high" | "medium" | "low";
  summary: string;
  sources: Array<{ title: string; url: string }>;
  noResults: boolean;
  currentValues: Record<string, string | undefined>;
}

interface FieldDecision {
  accept: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  mailingStreet: "Street Address",
  mailingCity: "City",
  mailingState: "State / Province",
  mailingPostalCode: "Postal Code",
  mailingCountry: "Country",
};

const FIELD_ORDER = ["email", "phone", "mobile", "mailingStreet", "mailingCity", "mailingState", "mailingPostalCode", "mailingCountry"];

function ConfidenceBadge({ confidence }: { confidence: string }) {
  if (confidence === "high") return <Badge variant="default" className="text-xs">High confidence</Badge>;
  if (confidence === "medium") return <Badge variant="secondary" className="text-xs">Medium confidence</Badge>;
  return <Badge variant="outline" className="text-xs">Low confidence</Badge>;
}

interface ContactResearchModalProps {
  entityType: "lead" | "contact" | "candidate_contact";
  entityId: string;
  entityName: string;
  onConfirm: (acceptedFields: Record<string, string>) => void;
}

export function ContactResearchButton({
  entityType,
  entityId,
  entityName,
  onConfirm,
}: ContactResearchModalProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, FieldDecision>>({});
  const { toast } = useToast();

  const researchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/contact-research", { entityType, entityId });
      return res.json() as Promise<ResearchResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      const initial: Record<string, FieldDecision> = {};
      for (const [field, suggestion] of Object.entries(data.suggestions)) {
        if (suggestion) {
          const currentVal = data.currentValues?.[field];
          initial[field] = { accept: !currentVal };
        }
      }
      setDecisions(initial);
    },
    onError: (err: Error) => {
      toast({ title: "Research failed", description: err.message, variant: "destructive" });
    },
  });

  const handleOpen = () => {
    setOpen(true);
    setResult(null);
    setDecisions({});
    researchMutation.mutate();
  };

  const handleConfirm = () => {
    if (!result) return;
    const accepted: Record<string, string> = {};
    for (const [field, decision] of Object.entries(decisions)) {
      if (decision.accept) {
        const suggestion = result.suggestions[field];
        if (suggestion?.value) {
          accepted[field] = suggestion.value;
        }
      }
    }
    onConfirm(accepted);
    setOpen(false);
    setResult(null);
  };

  const toggleDecision = (field: string) => {
    setDecisions(prev => ({
      ...prev,
      [field]: { accept: !prev[field]?.accept },
    }));
  };

  const activeSuggestions = result
    ? FIELD_ORDER.filter(f => result.suggestions[f])
    : [];

  const acceptedCount = Object.values(decisions).filter(d => d.accept).length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpen}
        data-testid="button-research-contact-info"
      >
        <Search className="h-4 w-4 mr-2" />
        Research Contact Info
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!researchMutation.isPending) setOpen(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Contact Info Research</DialogTitle>
            <DialogDescription>
              Searching public sources for contact information for <strong>{entityName}</strong>.
            </DialogDescription>
          </DialogHeader>

          {researchMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Searching public sources...</p>
            </div>
          )}

          {researchMutation.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{researchMutation.error?.message}</AlertDescription>
            </Alert>
          )}

          {result && !researchMutation.isPending && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <ConfidenceBadge confidence={result.confidence} />
                {result.summary && (
                  <p className="text-sm text-muted-foreground">{result.summary}</p>
                )}
              </div>

              {result.noResults && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>No new contact information was found in public sources.</AlertDescription>
                </Alert>
              )}

              {!result.noResults && activeSuggestions.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    Review each suggestion and choose which values to accept:
                  </p>

                  {activeSuggestions.map((field) => {
                    const suggestion = result.suggestions[field]!;
                    const currentVal = result.currentValues?.[field];
                    const hasExisting = !!currentVal;
                    const isAccepted = decisions[field]?.accept ?? false;

                    return (
                      <div
                        key={field}
                        className="border rounded-md p-4 space-y-3"
                        data-testid={`research-field-${field}`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium">{FIELD_LABELS[field] || field}</span>
                          <span className="text-xs text-muted-foreground">{suggestion.source}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {hasExisting && (
                            <div
                              className={`p-3 rounded-md border cursor-pointer transition-colors ${!isAccepted ? "border-primary bg-primary/5" : "border-border bg-muted/30"}`}
                              onClick={() => toggleDecision(field)}
                              data-testid={`research-keep-${field}`}
                            >
                              <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Current value</p>
                              <p className="text-sm">{currentVal}</p>
                              {!isAccepted && (
                                <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
                                  <CheckCircle className="h-3 w-3" /> Keep this
                                </div>
                              )}
                            </div>
                          )}

                          <div
                            className={`p-3 rounded-md border cursor-pointer transition-colors ${isAccepted ? "border-primary bg-primary/5" : "border-border bg-muted/30"} ${!hasExisting ? "col-span-full sm:col-span-1" : ""}`}
                            onClick={() => toggleDecision(field)}
                            data-testid={`research-accept-${field}`}
                          >
                            <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                              {hasExisting ? "AI suggestion" : "Found"}
                            </p>
                            <p className="text-sm">{suggestion.value}</p>
                            {isAccepted && (
                              <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
                                <CheckCircle className="h-3 w-3" /> Use this
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {result.sources && result.sources.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sources</p>
                    {result.sources.map((source, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs" data-testid={`research-source-${idx}`}>
                        <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          {source.title && <p className="text-muted-foreground truncate">{source.title}</p>}
                          {source.url && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline break-all"
                            >
                              {source.url}
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={researchMutation.isPending}>
              Cancel
            </Button>
            {result && !result.noResults && acceptedCount > 0 && (
              <Button onClick={handleConfirm} data-testid="button-confirm-research">
                Apply {acceptedCount} {acceptedCount === 1 ? "change" : "changes"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
