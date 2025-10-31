import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { DetailPageLayout, DetailSection, DetailField } from "@/components/detail-page-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Activity, Account, Contact, Opportunity, Lead } from "@shared/schema";

export default function ActivityDetailPage() {
  const [, params] = useRoute("/activities/:id");
  const [, setLocation] = useLocation();
  const activityId = params?.id;

  const { data: activity, isLoading: activityLoading } = useQuery<Activity>({
    queryKey: ["/api/activities", activityId],
    enabled: !!activityId,
  });

  const { data: relatedData, isLoading: relatedLoading } = useQuery<{
    relatedEntity: {
      type: "Account" | "Contact" | "Opportunity" | "Lead";
      data: Account | Contact | Opportunity | Lead;
    } | null;
  }>({
    queryKey: ["/api/activities", activityId, "related"],
    enabled: !!activityId,
  });

  if (activityLoading || relatedLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Activity not found</p>
      </div>
    );
  }

  const getStatusVariant = (status: string) => {
    if (status === "completed") return "default";
    if (status === "in_progress") return "secondary";
    return "outline";
  };

  const getRelatedEntityInfo = () => {
    if (!relatedData?.relatedEntity) return null;

    const { type, data } = relatedData.relatedEntity;
    
    if (type === "Account") {
      const account = data as Account;
      return {
        type: "Account",
        name: account.name,
        link: `/accounts/${account.id}`,
      };
    } else if (type === "Contact") {
      const contact = data as Contact;
      return {
        type: "Contact",
        name: `${contact.firstName} ${contact.lastName}`,
        link: `/contacts/${contact.id}`,
      };
    } else if (type === "Opportunity") {
      const opp = data as Opportunity;
      return {
        type: "Opportunity",
        name: opp.name,
        link: `/opportunities/${opp.id}`,
      };
    } else if (type === "Lead") {
      const lead = data as Lead;
      return {
        type: "Lead",
        name: `${lead.firstName} ${lead.lastName}`,
        link: `/leads/${lead.id}`,
      };
    }
    return null;
  };

  const relatedEntityInfo = getRelatedEntityInfo();

  return (
    <DetailPageLayout
      title={activity.subject}
      subtitle={activity.id}
      backLink="/activities"
      backLabel="Activities"
      status={activity.status}
      statusVariant={getStatusVariant(activity.status)}
      onEdit={() => {
        // TODO: Open edit dialog
      }}
      onDelete={() => {
        // TODO: Show delete confirmation
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <DetailSection title="Activity Information">
            <DetailField label="Subject" value={activity.subject} />
            <DetailField label="Activity ID" value={activity.id} />
            <DetailField label="Type" value={activity.type} />
            <DetailField label="Status" value={activity.status} />
            <DetailField label="Priority" value={activity.priority} />
            <DetailField label="Due Date" value={activity.dueDate} type="date" />
          </DetailSection>

          {activity.description && (
            <DetailSection title="Description">
              <div className="col-span-full">
                <p className="text-sm whitespace-pre-wrap">{activity.description}</p>
              </div>
            </DetailSection>
          )}
        </div>

        <div className="space-y-6">
          {relatedEntityInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Related {relatedEntityInfo.type}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setLocation(relatedEntityInfo.link)}
                  data-testid={`link-related-${relatedEntityInfo.type.toLowerCase()}`}
                >
                  {relatedEntityInfo.name}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DetailPageLayout>
  );
}
