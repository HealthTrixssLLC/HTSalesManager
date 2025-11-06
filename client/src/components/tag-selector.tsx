import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge, type Tag } from "@/components/ui/tag-badge";
import { CreateTagDialog } from "@/components/create-tag-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tags: Tag[]) => void;
  entity: string;
  entityId?: string;
}

export function TagSelector({ selectedTags, onTagsChange, entity, entityId }: TagSelectorProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ["/api/tags"],
  });

  const addEntityTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      if (!entityId) throw new Error("Entity ID is required");
      const res = await apiRequest("POST", "/api/entity-tags", {
        entity,
        entityId,
        tagId,
        createdBy: user?.id,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-tags"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add tag",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeEntityTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      if (!entityId) throw new Error("Entity ID is required");
      const res = await apiRequest("DELETE", `/api/entity-tags/${entity}/${entityId}/${tagId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/entity-tags"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove tag",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTagSelect = (tag: Tag) => {
    const isSelected = selectedTags.some((t) => t.id === tag.id);
    if (isSelected) {
      const newTags = selectedTags.filter((t) => t.id !== tag.id);
      onTagsChange(newTags);
      if (entityId) {
        removeEntityTagMutation.mutate(tag.id);
      }
    } else {
      const newTags = [...selectedTags, tag];
      onTagsChange(newTags);
      if (entityId) {
        addEntityTagMutation.mutate(tag.id);
      }
    }
  };

  const handleRemoveTag = (tagId: string) => {
    const newTags = selectedTags.filter((t) => t.id !== tagId);
    onTagsChange(newTags);
    if (entityId) {
      removeEntityTagMutation.mutate(tagId);
    }
  };

  return (
    <div className="space-y-2">
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              onRemove={() => handleRemoveTag(tag.id)}
            />
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            data-testid="button-open-tag-selector"
          >
            {selectedTags.length > 0
              ? `${selectedTags.length} tag(s) selected`
              : "Select tags..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0">
          <Command>
            <CommandInput
              placeholder="Search tags..."
              data-testid="input-tag-search"
            />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setCreateDialogOpen(true);
                  }}
                  data-testid="option-create-new-tag"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create New Tag
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Available Tags">
                {allTags.map((tag) => {
                  const isSelected = selectedTags.some((t) => t.id === tag.id);
                  return (
                    <CommandItem
                      key={tag.id}
                      onSelect={() => handleTagSelect(tag)}
                      data-testid={`option-tag-${tag.id}`}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          isSelected ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div
                        className="w-3 h-3 rounded-sm mr-2"
                        style={{ backgroundColor: tag.color }}
                      />
                      {tag.name}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <CreateTagDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={(newTag) => {
          handleTagSelect(newTag);
        }}
      />
    </div>
  );
}
