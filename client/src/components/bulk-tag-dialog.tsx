import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TagSelector } from "@/components/tag-selector";
import { type Tag } from "@/components/ui/tag-badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  entity: string;
  onSuccess?: () => void;
  dataTestId?: string;
}

export function BulkTagDialog({ open, onOpenChange, selectedIds, entity, onSuccess, dataTestId }: BulkTagDialogProps) {
  const { toast } = useToast();
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);

  const bulkTagMutation = useMutation({
    mutationFn: async ({ entityIds, tagIds }: { entityIds: string[]; tagIds: string[] }) => {
      const res = await apiRequest("POST", `/api/${entity}/bulk-tags`, { entityIds, tagIds });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/${entity}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/entity-tags"] });
      toast({ 
        title: `Successfully added tags to ${data.count} ${entity}${data.count !== 1 ? 's' : ''}` 
      });
      setSelectedTags([]);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({ 
        title: `Failed to add tags to ${entity}`, 
        description: error.message, 
        variant: "destructive" 
      });
    },
  });

  const handleAddTags = () => {
    if (selectedTags.length === 0) {
      toast({ title: "Please select at least one tag", variant: "destructive" });
      return;
    }
    bulkTagMutation.mutate({
      entityIds: selectedIds,
      tagIds: selectedTags.map(t => t.id),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={dataTestId}>
        <DialogHeader>
          <DialogTitle>
            Add Tags to {selectedIds.length} {entity.charAt(0).toUpperCase() + entity.slice(1)}
            {selectedIds.length !== 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Select tags to add to the selected {entity}. These tags will be added to all selected items.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <TagSelector
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
            entity={entity}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleAddTags} 
            disabled={bulkTagMutation.isPending || selectedTags.length === 0}
            data-testid="button-confirm-bulk-tags"
          >
            <Tags className="h-4 w-4 mr-2" />
            {bulkTagMutation.isPending ? "Adding..." : "Add Tags"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
