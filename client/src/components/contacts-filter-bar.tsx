import { useState, useEffect, useRef } from "react";
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

interface ContactFilters {
  search: string;
  accountId: string;
  ownerId: string;
  hasEmail: string;
  tagIds: string[];
}

interface ContactsFilterBarProps {
  onFilterChange: (filters: ContactFilters) => void;
  totalCount: number;
  filteredCount: number;
  initialFilters?: Partial<ContactFilters>;
}

export function ContactsFilterBar({ onFilterChange, totalCount, filteredCount, initialFilters }: ContactsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [accountId, setAccountId] = useState(initialFilters?.accountId ?? "");
  const [ownerId, setOwnerId] = useState(initialFilters?.ownerId ?? "");
  const [hasEmail, setHasEmail] = useState(initialFilters?.hasEmail ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialFilters?.tagIds ?? []);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const hasEmailRef = useRef(hasEmail);
  hasEmailRef.current = hasEmail;
  const selectedTagIdsRef = useRef(selectedTagIds);
  selectedTagIdsRef.current = selectedTagIds;

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  // Notify parent on mount with initial values
  useEffect(() => {
    onFilterChangeRef.current({
      search: initialFilters?.search ?? "",
      accountId: initialFilters?.accountId ?? "",
      ownerId: initialFilters?.ownerId ?? "",
      hasEmail: initialFilters?.hasEmail ?? "",
      tagIds: initialFilters?.tagIds ?? [],
    });
  }, []);

  const notify = (newSearch: string, newAccountId: string, newOwnerId: string, newHasEmail: string, newTagIds: string[]) => {
    onFilterChangeRef.current({ search: newSearch, accountId: newAccountId, ownerId: newOwnerId, hasEmail: newHasEmail, tagIds: newTagIds });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      notify(value, accountIdRef.current, ownerIdRef.current, hasEmailRef.current, selectedTagIdsRef.current);
    }, 300);
  };

  const handleAccountChange = (value: string) => {
    const newAccountId = value === "all" ? "" : value;
    setAccountId(newAccountId);
    notify(search, newAccountId, ownerId, hasEmail, selectedTagIds);
  };

  const handleOwnerChange = (value: string) => {
    const newOwner = value === "all" ? "" : value;
    setOwnerId(newOwner);
    notify(search, accountId, newOwner, hasEmail, selectedTagIds);
  };

  const handleHasEmailChange = (value: string) => {
    const newHasEmail = value === "all" ? "" : value;
    setHasEmail(newHasEmail);
    notify(search, accountId, ownerId, newHasEmail, selectedTagIds);
  };

  const handleTagIdsChange = (newTagIds: string[]) => {
    setSelectedTagIds(newTagIds);
    notify(search, accountId, ownerId, hasEmail, newTagIds);
  };

  const handleClearFilters = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearch("");
    setAccountId("");
    setOwnerId("");
    setHasEmail("");
    setSelectedTagIds([]);
    notify("", "", "", "", []);
  };

  const handleMyContacts = () => {
    const newOwner = user?.id || "";
    setOwnerId(newOwner);
    setAccountId("");
    setHasEmail("");
    notify(search, "", newOwner, "", selectedTagIds);
  };

  const handleWithEmail = () => {
    setHasEmail("true");
    setOwnerId("");
    setAccountId("");
    notify(search, "", "", "true", selectedTagIds);
  };

  const handleAllContacts = () => {
    setOwnerId("");
    setAccountId("");
    setHasEmail("");
    setSelectedTagIds([]);
    notify(search, "", "", "", []);
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
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search-contacts"
            />
          </div>
        </div>

        <Select value={accountId || undefined} onValueChange={handleAccountChange}>
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

        <Select value={ownerId || undefined} onValueChange={handleOwnerChange}>
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

        <Select value={hasEmail || undefined} onValueChange={handleHasEmailChange}>
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
