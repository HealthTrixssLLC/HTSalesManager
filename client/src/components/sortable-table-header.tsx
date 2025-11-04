import { ChevronUp, ChevronDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

interface SortableTableHeaderProps {
  label: string;
  field: string;
  currentSortBy: string;
  currentSortOrder: "asc" | "desc";
  onSort: (field: string) => void;
  className?: string;
}

export function SortableTableHeader({
  label,
  field,
  currentSortBy,
  currentSortOrder,
  onSort,
  className,
}: SortableTableHeaderProps) {
  const isActive = currentSortBy === field;

  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSort(field)}
        className="hover-elevate -ml-3 h-8 data-[state=open]:bg-accent"
        data-testid={`button-sort-${field}`}
      >
        {label}
        {isActive && (
          <>
            {currentSortOrder === "asc" ? (
              <ChevronUp className="ml-2 h-4 w-4" />
            ) : (
              <ChevronDown className="ml-2 h-4 w-4" />
            )}
          </>
        )}
      </Button>
    </TableHead>
  );
}
