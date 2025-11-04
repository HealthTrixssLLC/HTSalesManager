import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { AccountCategory } from "@shared/schema";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AccountsFilterBarProps {
  onFilterChange: (filters: {
    search: string;
    type: string;
    category: string;
    ownerId: string;
  }) => void;
  totalCount: number;
  filteredCount: number;
}

export function AccountsFilterBar({ onFilterChange, totalCount, filteredCount }: AccountsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: categories } = useQuery<AccountCategory[]>({
    queryKey: ["/api/admin/categories"],
  });

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Notify parent of filter changes
  useEffect(() => {
    onFilterChange({
      search: debouncedSearch,
      type,
      category,
      ownerId,
    });
  }, [debouncedSearch, type, category, ownerId, onFilterChange]);

  const handleClearFilters = () => {
    setSearch("");
    setType("");
    setCategory("");
    setOwnerId("");
  };

  const handleMyAccounts = () => {
    setOwnerId(user?.id || "");
    setType("");
    setCategory("");
  };

  const handleAllAccounts = () => {
    setOwnerId("");
    setType("");
    setCategory("");
  };

  const hasActiveFilters = search || type || category || ownerId;

  return (
    <div className="space-y-4" data-testid="accounts-filter-bar">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search accounts by name, number, industry, or website..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-accounts"
            />
          </div>
        </div>

        <Select value={type || "all"} onValueChange={(value) => setType(value === "all" ? "" : value)}>
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

        <Select value={category || "all"} onValueChange={(value) => setCategory(value === "all" ? "" : value)}>
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

        <Select value={ownerId || "all"} onValueChange={(value) => setOwnerId(value === "all" ? "" : value)}>
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
