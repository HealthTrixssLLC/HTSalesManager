import { useState, useEffect } from "react";
import { Columns } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Column {
  id: string;
  label: string;
}

interface ColumnVisibilityProps {
  columns: Column[];
  storageKey: string;
  onVisibilityChange: (visibleColumns: string[]) => void;
}

const PRESETS = {
  minimal: ["id", "name", "type"],
  standard: ["id", "name", "type", "category", "ownerId", "phone"],
  all: [] as string[],
};

export function ColumnVisibility({ columns, storageKey, onVisibilityChange }: ColumnVisibilityProps) {
  // Initialize with all columns visible
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return columns.map(c => c.id);
      }
    }
    return columns.map(c => c.id);
  });

  // Update localStorage and notify parent when visibility changes
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(visibleColumns));
    onVisibilityChange(visibleColumns);
  }, [visibleColumns, storageKey, onVisibilityChange]);

  const toggleColumn = (columnId: string) => {
    setVisibleColumns(prev =>
      prev.includes(columnId)
        ? prev.filter(id => id !== columnId)
        : [...prev, columnId]
    );
  };

  const applyPreset = (preset: keyof typeof PRESETS) => {
    if (preset === "all") {
      setVisibleColumns(columns.map(c => c.id));
    } else {
      const presetColumns = PRESETS[preset];
      setVisibleColumns(presetColumns.filter(id => columns.some(c => c.id === id)));
    }
  };

  const toggleAll = () => {
    if (visibleColumns.length === columns.length) {
      setVisibleColumns([]);
    } else {
      setVisibleColumns(columns.map(c => c.id));
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="default" data-testid="button-column-visibility">
          <Columns className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Column Visibility</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <div className="p-2 space-y-1">
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset("minimal")}
              className="flex-1 h-7 text-xs"
              data-testid="button-preset-minimal"
            >
              Minimal
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset("standard")}
              className="flex-1 h-7 text-xs"
              data-testid="button-preset-standard"
            >
              Standard
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyPreset("all")}
              className="flex-1 h-7 text-xs"
              data-testid="button-preset-all"
            >
              All
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAll}
            className="w-full h-7 text-xs"
            data-testid="button-toggle-all"
          >
            {visibleColumns.length === columns.length ? "Hide All" : "Show All"}
          </Button>
        </div>

        <DropdownMenuSeparator />

        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={visibleColumns.includes(column.id)}
            onCheckedChange={() => toggleColumn(column.id)}
            data-testid={`checkbox-column-${column.id}`}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
