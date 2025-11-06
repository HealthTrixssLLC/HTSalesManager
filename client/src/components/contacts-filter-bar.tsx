import { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { TagFilterButton } from "@/components/tag-filter-button";

interface User {
  id: string;
  name: string;
  email: string;
}

interface Account {
  id: string;
  name: string;
}

interface ContactsFilterBarProps {
  onFilterChange: (filters: {
    search: string;
    accountId: string;
    ownerId: string;
    hasEmail: string;
    tagIds: string[];
  }) => void;
  totalCount: number;
  filteredCount: number;
}

export function ContactsFilterBar({ onFilterChange, totalCount, filteredCount }: ContactsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [hasEmail, setHasEmail] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
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
      accountId: accountId === "all" ? "" : accountId,
      ownerId: ownerId === "all" ? "" : ownerId,
      hasEmail: hasEmail === "all" ? "" : hasEmail,
      tagIds: selectedTagIds,
    });
  }, [debouncedSearch, accountId, ownerId, hasEmail, selectedTagIds, onFilterChange]);

  const handleClearFilters = () => {
    setSearch("");
    setAccountId("");
    setOwnerId("");
    setHasEmail("");
    setSelectedTagIds([]);
  };

  const handleMyContacts = () => {
    setOwnerId(user?.id || "");
    setAccountId("");
    setHasEmail("");
  };

  const handleWithEmail = () => {
    setHasEmail("true");
    setOwnerId("");
    setAccountId("");
  };

  const handleAllContacts = () => {
    setOwnerId("");
    setAccountId("");
    setHasEmail("");
    setSelectedTagIds([]);
  };

  const hasActiveFilters = search || accountId || ownerId || hasEmail || selectedTagIds.length > 0;

  return (
    <div className="space-y-4" data-testid="contacts-filter-bar">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts by name, email, phone, or title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-contacts"
            />
          </div>
        </div>

        <Select value={accountId || undefined} onValueChange={setAccountId}>
          <SelectTrigger className="w-[180px]" data-testid="select-filter-account">
            <SelectValue placeholder="All Accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Accounts</SelectItem>
            {accounts?.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={ownerId || undefined} onValueChange={setOwnerId}>
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

        <Select value={hasEmail || undefined} onValueChange={setHasEmail}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-email">
            <SelectValue placeholder="Email Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contacts</SelectItem>
            <SelectItem value="true">With Email</SelectItem>
            <SelectItem value="false">Without Email</SelectItem>
          </SelectContent>
        </Select>

        <TagFilterButton
          selectedTagIds={selectedTagIds}
          onTagIdsChange={setSelectedTagIds}
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
          onClick={handleMyContacts}
          data-testid="button-my-contacts"
        >
          My Contacts
        </Button>
        <Button
          variant={hasEmail === "true" ? "default" : "outline"}
          size="sm"
          onClick={handleWithEmail}
          data-testid="button-with-email"
        >
          With Email
        </Button>
        <Button
          variant={!ownerId && !hasEmail ? "default" : "outline"}
          size="sm"
          onClick={handleAllContacts}
          data-testid="button-all-contacts"
        >
          All Contacts
        </Button>

        <Badge variant="secondary" className="ml-auto" data-testid="badge-filter-count">
          {filteredCount} of {totalCount} contacts
        </Badge>
      </div>
    </div>
  );
}
