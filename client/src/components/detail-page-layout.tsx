import { Link } from "wouter";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DetailPageLayoutProps {
  title: string;
  subtitle?: string;
  backLink: string;
  backLabel: string;
  status?: string;
  statusVariant?: "default" | "secondary" | "destructive" | "outline";
  onEdit?: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}

export function DetailPageLayout({
  title,
  subtitle,
  backLink,
  backLabel,
  status,
  statusVariant = "default",
  onEdit,
  onDelete,
  children,
}: DetailPageLayoutProps) {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={backLink}>
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{title}</h1>
              {status && (
                <Badge variant={statusVariant} data-testid={`badge-status-${status.toLowerCase()}`}>
                  {status}
                </Badge>
              )}
            </div>
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onEdit && (
            <Button variant="outline" onClick={onEdit} data-testid="button-edit">
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          {onDelete && (
            <Button variant="destructive" onClick={onDelete} data-testid="button-delete">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

interface DetailFieldProps {
  label: string;
  value?: string | number | null;
  type?: "text" | "email" | "phone" | "url" | "currency" | "date" | "percent";
}

export function DetailField({ label, value, type = "text" }: DetailFieldProps) {
  if (!value && value !== 0) {
    return (
      <div>
        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-1 text-sm text-muted-foreground">—</dd>
      </div>
    );
  }

  let displayValue = value;
  
  if (type === "currency" && typeof value === "number") {
    displayValue = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  } else if (type === "percent" && typeof value === "number") {
    displayValue = `${value}%`;
  } else if (type === "date" && typeof value === "string") {
    displayValue = new Date(value).toLocaleDateString();
  }

  const content = (
    <>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm" data-testid={`field-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {type === "email" ? (
          <a href={`mailto:${value}`} className="text-primary hover:underline">
            {displayValue}
          </a>
        ) : type === "phone" ? (
          <a href={`tel:${value}`} className="text-primary hover:underline">
            {displayValue}
          </a>
        ) : type === "url" ? (
          <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {displayValue}
          </a>
        ) : (
          displayValue
        )}
      </dd>
    </>
  );

  return <div>{content}</div>;
}

interface DetailSectionProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function DetailSection({ title, children, actions }: DetailSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {children}
        </dl>
      </CardContent>
    </Card>
  );
}
