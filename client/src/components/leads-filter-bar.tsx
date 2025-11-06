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

interface LeadsFilterBarProps {
  onFilterChange: (filters: {
    search: string;
    status: string;
    source: string;
    rating: string;
    ownerId: string;
    tagIds: string[];
  }) => void;
  totalCount: number;
  filteredCount: number;
}

export function LeadsFilterBar({ onFilterChange, totalCount, filteredCount }: LeadsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [rating, setRating] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
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
      status: status === "all" ? "" : status,
      source: source === "all" ? "" : source,
      rating: rating === "all" ? "" : rating,
      ownerId: ownerId === "all" ? "" : ownerId,
      tagIds: selectedTagIds,
    });
  }, [debouncedSearch, status, source, rating, ownerId, selectedTagIds, onFilterChange]);

  const handleClearFilters = () => {
    setSearch("");
    setStatus("");
    setSource("");
    setRating("");
    setOwnerId("");
    setSelectedTagIds([]);
  };

  const handleMyLeads = () => {
    setOwnerId(user?.id || "");
    setStatus("");
    setSource("");
    setRating("");
  };

  const handleHotLeads = () => {
    setRating("hot");
    setOwnerId("");
    setStatus("");
    setSource("");
  };

  const handleQualified = () => {
    setStatus("qualified");
    setOwnerId("");
    setSource("");
    setRating("");
  };

  const handleAllLeads = () => {
    setOwnerId("");
    setStatus("");
    setSource("");
    setRating("");
    setSelectedTagIds([]);
  };

  const hasActiveFilters = search || status || source || rating || ownerId || selectedTagIds.length > 0;

  return (
    <div className="space-y-4" data-testid="leads-filter-bar">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leads by name, email, phone, company, or topic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-leads"
            />
          </div>
        </div>

        <Select value={status || undefined} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-status">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
          </SelectContent>
        </Select>

        <Select value={source || undefined} onValueChange={setSource}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-source">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="website">Website</SelectItem>
            <SelectItem value="referral">Referral</SelectItem>
            <SelectItem value="phone">Phone</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="event">Event</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select value={rating || undefined} onValueChange={setRating}>
          <SelectTrigger className="w-[160px]" data-testid="select-filter-rating">
            <SelectValue placeholder="All Ratings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ratings</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
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
          onClick={handleMyLeads}
          data-testid="button-my-leads"
        >
          My Leads
        </Button>
        <Button
          variant={rating === "hot" ? "default" : "outline"}
          size="sm"
          onClick={handleHotLeads}
          data-testid="button-hot-leads"
        >
          Hot Leads
        </Button>
        <Button
          variant={status === "qualified" ? "default" : "outline"}
          size="sm"
          onClick={handleQualified}
          data-testid="button-qualified"
        >
          Qualified
        </Button>
        <Button
          variant={!ownerId && !status && !rating ? "default" : "outline"}
          size="sm"
          onClick={handleAllLeads}
          data-testid="button-all-leads"
        >
          All Leads
        </Button>

        <Badge variant="secondary" className="ml-auto" data-testid="badge-filter-count">
          {filteredCount} of {totalCount} leads
        </Badge>
      </div>
    </div>
  );
}
