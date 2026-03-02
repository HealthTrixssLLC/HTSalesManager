import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    testId?: string;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center" data-testid="empty-state">
      <div
        className="h-14 w-14 rounded-xl flex items-center justify-center mb-4"
        style={{ background: "hsl(186, 45%, 94%)" }}
      >
        <Icon className="h-7 w-7" style={{ color: "hsl(186, 78%, 32%)" }} />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-xs mb-4">{description}</p>
      )}
      {action && (
        <Button size="sm" onClick={action.onClick} data-testid={action.testId}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
