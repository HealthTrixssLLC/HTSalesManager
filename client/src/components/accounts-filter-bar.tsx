import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { AccountCategory } from "@shared/schema";
import { TagFilterButton } from "@/components/tag-filter-button";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AccountFilters {
  search: string;
  type: string;
  category: string;
  ownerId: string;
  tagIds: string[];
}

interface AccountsFilterBarProps {
  onFilterChange: (filters: AccountFilters) => void;
  totalCount: number;
  filteredCount: number;
  initialFilters?: Partial<AccountFilters>;
}

export function AccountsFilterBar({ onFilterChange, totalCount, filteredCount, initialFilters }: AccountsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [type, setType] = useState(initialFilters?.type ?? "");
  const [category, setCategory] = useState(initialFilters?.category ?? "");
  const [ownerId, setOwnerId] = useState(initialFilters?.ownerId ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialFilters?.tagIds ?? []);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  const typeRef = useRef(type);
  typeRef.current = type;
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const selectedTagIdsRef = useRef(selectedTagIds);
  selectedTagIdsRef.current = selectedTagIds;

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: categories } = useQuery<AccountCategory[]>({
    queryKey: ["/api/admin/categories"],
  });

  // Notify parent on mount with initial values
  useEffect(() => {
    onFilterChangeRef.current({
      search: initialFilters?.search ?? "",
      type: initialFilters?.type ?? "",
      category: initialFilters?.category ?? "",
      ownerId: initialFilters?.ownerId ?? "",
      tagIds: initialFilters?.tagIds ?? [],
    });
  }, []);

  const notify = (newSearch: string, newType: string, newCategory: string, newOwnerId: string, newTagIds: string[]) => {
    onFilterChangeRef.current({ search: newSearch, type: newType, category: newCategory, ownerId: newOwnerId, tagIds: newTagIds });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      notify(value, typeRef.current, categoryRef.current, ownerIdRef.current, selectedTagIdsRef.current);
    }, 300);
  };

  const handleTypeChange = (value: string) => {
    const newType = value === "all" ? "" : value;
    setType(newType);
    notify(search, newType, category, ownerId, selectedTagIds);
  };

  const handleCategoryChange = (value: string) => {
    const newCategory = value === "all" ? "" : value;
    setCategory(newCategory);
    notify(search, type, newCategory, ownerId, selectedTagIds);
  };

  const handleOwnerChange = (value: string) => {
    const newOwner = value === "all" ? "" : value;
    setOwnerId(newOwner);
    notify(search, type, category, newOwner, selectedTagIds);
  };

  const handleTagIdsChange = (newTagIds: string[]) => {
    setSelectedTagIds(newTagIds);
    notify(search, type, category, ownerId, newTagIds);
  };

  const handleClearFilters = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearch("");
    setType("");
    setCategory("");
    setOwnerId("");
    setSelectedTagIds([]);
    notify("", "", "", "", []);
  };

  const handleMyAccounts = () => {
    const newOwner = user?.id || "";
    setOwnerId(newOwner);
    setType("");
    setCategory("");
    notify(search, "", "", newOwner, selectedTagIds);
  };

  const handleAllAccounts = () => {
    setOwnerId("");
    setType("");
    setCategory("");
    setSelectedTagIds([]);
    notify(search, "", "", "", []);
  };

  const hasActiveFilters = search || type || category || ownerId || selectedTagIds.length > 0;

  return (
    <div className="space-y-4" data-testid="accounts-filter-bar">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search accounts by name, number, industry, or website..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search-accounts"
            />
          </div>
        </div>

        <Select value={type || "all"} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-type">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="vendor">Vendor</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select value={category || "all"} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-category">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories?.filter(c => c.isActive).map((cat) => (
              <SelectItem key={cat.id} value={cat.name}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerId || "all"} onValueChange={handleOwnerChange}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-owner">
            <SelectValue placeholder="All Owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {users?.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TagFilterButton
          selectedTagIds={selectedTagIds}
          onTagIdsChange={handleTagIdsChange}
        />

        {hasActiveFilters && (
          <Button
            variant="outline"
            size="default"
            onClick={handleClearFilters}
            data-testid="button-clear-filters"
          >
            <X className="h-4 w-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Button
          variant={ownerId === user?.id ? "default" : "outline"}
          size="sm"
          onClick={handleMyAccounts}
          data-testid="button-my-accounts"
        >
          My Accounts
        </Button>
        <Button
          variant={!ownerId ? "default" : "outline"}
          size="sm"
          onClick={handleAllAccounts}
          data-testid="button-all-accounts"
        >
          All Accounts
        </Button>

        <Badge variant="secondary" className="ml-auto" data-testid="badge-filter-count">
          {filteredCount} of {totalCount} accounts
        </Badge>
      </div>
    </div>
  );
}
