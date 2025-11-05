import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useQuery } from "@tanstack/react-query";

interface EntitySearchResult {
  id: string;
  name: string;
  type: string;
  displayName: string;
}

interface EntityComboboxProps {
  value?: string; // Selected entity ID
  onChange: (entityId: string, entityType: string, displayName: string) => void;
  entityType?: "Account" | "Contact" | "Lead" | "Opportunity"; // Filter by specific type
  placeholder?: string;
  className?: string;
  testId?: string;
}

export function EntityCombobox({
  value,
  onChange,
  entityType,
  placeholder = "Search entities...",
  className,
  testId,
}: EntityComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch search results
  const { data: searchResults = [], isLoading } = useQuery<EntitySearchResult[]>({
    queryKey: ["/api/entities/search", { q: debouncedQuery, type: entityType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("q", debouncedQuery);
      if (entityType) {
        params.append("type", entityType);
      }
      const res = await fetch(`/api/entities/search?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to search entities");
      }
      return await res.json();
    },
    enabled: debouncedQuery.length > 0,
  });

  // Find selected entity display name
  const selectedEntity = searchResults.find((entity) => entity.id === value);
  const displayText = selectedLabel || selectedEntity?.displayName || value || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
          data-testid={testId}
        >
          <span className="truncate">{displayText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={searchQuery}
            onValueChange={setSearchQuery}
            data-testid={`${testId}-search-input`}
          />
          <CommandList>
            {isLoading && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {!isLoading && searchQuery && searchResults.length === 0 && (
              <CommandEmpty>No entities found.</CommandEmpty>
            )}
            {!isLoading && searchResults.length > 0 && (
              <CommandGroup>
                {searchResults.map((entity) => (
                  <CommandItem
                    key={`${entity.type}-${entity.id}`}
                    value={entity.id}
                    onSelect={() => {
                      onChange(entity.id, entity.type, entity.displayName);
                      setSelectedLabel(entity.displayName);
                      setOpen(false);
                      setSearchQuery("");
                    }}
                    data-testid={`${testId}-option-${entity.id}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === entity.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm">{entity.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        {entity.type} • {entity.id}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
