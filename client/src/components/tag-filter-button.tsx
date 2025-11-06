import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tag as TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import type { Tag } from "@/components/ui/tag-badge";

interface TagFilterButtonProps {
  selectedTagIds: string[];
  onTagIdsChange: (tagIds: string[]) => void;
}

export function TagFilterButton({ selectedTagIds, onTagIdsChange }: TagFilterButtonProps) {
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ["/api/tags"],
  });

  const handleTagToggle = (tagId: string) => {
    const newTagIds = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter(id => id !== tagId)
      : [...selectedTagIds, tagId];
    onTagIdsChange(newTagIds);
  };

  return (
    <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-[160px] justify-start"
          data-testid="button-filter-tags"
        >
          <TagIcon className="h-4 w-4 mr-2" />
          {selectedTagIds.length > 0 ? `${selectedTagIds.length} tag(s)` : "All Tags"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search tags..." />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
            <CommandGroup>
              {allTags.map((tag) => (
                <CommandItem
                  key={tag.id}
                  onSelect={() => handleTagToggle(tag.id)}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={selectedTagIds.includes(tag.id)}
                    data-testid={`checkbox-tag-${tag.id}`}
                  />
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span>{tag.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
