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

interface LeadFilters {
  search: string;
  status: string;
  source: string;
  rating: string;
  ownerId: string;
  tagIds: string[];
}

interface LeadsFilterBarProps {
  onFilterChange: (filters: LeadFilters) => void;
  totalCount: number;
  filteredCount: number;
  initialFilters?: Partial<LeadFilters>;
}

export function LeadsFilterBar({ onFilterChange, totalCount, filteredCount, initialFilters }: LeadsFilterBarProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [status, setStatus] = useState(initialFilters?.status ?? "");
  const [source, setSource] = useState(initialFilters?.source ?? "");
  const [rating, setRating] = useState(initialFilters?.rating ?? "");
  const [ownerId, setOwnerId] = useState(initialFilters?.ownerId ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialFilters?.tagIds ?? []);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFilterChangeRef = useRef(onFilterChange);
  onFilterChangeRef.current = onFilterChange;

  const statusRef = useRef(status);
  statusRef.current = status;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const ratingRef = useRef(rating);
  ratingRef.current = rating;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const selectedTagIdsRef = useRef(selectedTagIds);
  selectedTagIdsRef.current = selectedTagIds;

  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Notify parent on mount with initial values
  useEffect(() => {
    onFilterChangeRef.current({
      search: initialFilters?.search ?? "",
      status: initialFilters?.status ?? "",
      source: initialFilters?.source ?? "",
      rating: initialFilters?.rating ?? "",
      ownerId: initialFilters?.ownerId ?? "",
      tagIds: initialFilters?.tagIds ?? [],
    });
  }, []);

  const notify = (newSearch: string, newStatus: string, newSource: string, newRating: string, newOwnerId: string, newTagIds: string[]) => {
    onFilterChangeRef.current({ search: newSearch, status: newStatus, source: newSource, rating: newRating, ownerId: newOwnerId, tagIds: newTagIds });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      notify(value, statusRef.current, sourceRef.current, ratingRef.current, ownerIdRef.current, selectedTagIdsRef.current);
    }, 300);
  };

  const handleStatusChange = (value: string) => {
    const newStatus = value === "all" ? "" : value;
    setStatus(newStatus);
    notify(search, newStatus, source, rating, ownerId, selectedTagIds);
  };

  const handleSourceChange = (value: string) => {
    const newSource = value === "all" ? "" : value;
    setSource(newSource);
    notify(search, status, newSource, rating, ownerId, selectedTagIds);
  };

  const handleRatingChange = (value: string) => {
    const newRating = value === "all" ? "" : value;
    setRating(newRating);
    notify(search, status, source, newRating, ownerId, selectedTagIds);
  };

  const handleOwnerChange = (value: string) => {
    const newOwner = value === "all" ? "" : value;
    setOwnerId(newOwner);
    notify(search, status, source, rating, newOwner, selectedTagIds);
  };

  const handleTagIdsChange = (newTagIds: string[]) => {
    setSelectedTagIds(newTagIds);
    notify(search, status, source, rating, ownerId, newTagIds);
  };

  const handleClearFilters = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearch("");
    setStatus("");
    setSource("");
    setRating("");
    setOwnerId("");
    setSelectedTagIds([]);
    notify("", "", "", "", "", []);
  };

  const handleMyLeads = () => {
    const newOwner = user?.id || "";
    setOwnerId(newOwner);
    setStatus("");
    setSource("");
    setRating("");
    notify(search, "", "", "", newOwner, selectedTagIds);
  };

  const handleHotLeads = () => {
    setRating("hot");
    setOwnerId("");
    setStatus("");
    setSource("");
    notify(search, "", "", "hot", "", selectedTagIds);
  };

  const handleQualified = () => {
    setStatus("qualified");
    setOwnerId("");
    setSource("");
    setRating("");
    notify(search, "qualified", "", "", "", selectedTagIds);
  };

  const handleAllLeads = () => {
    setOwnerId("");
    setStatus("");
    setSource("");
    setRating("");
    setSelectedTagIds([]);
    notify(search, "", "", "", "", []);
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
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              data-testid="input-search-leads"
            />
          </div>
        </div>

        <Select value={status || undefined} onValueChange={handleStatusChange}>
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

        <Select value={source || undefined} onValueChange={handleSourceChange}>
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

        <Select value={rating || undefined} onValueChange={handleRatingChange}>
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
