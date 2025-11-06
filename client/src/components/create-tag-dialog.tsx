import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const PRESET_COLORS = [
  { name: "Health Trixss Teal", value: "#0D7C7C" },
  { name: "Sky Blue", value: "#0ea5e9" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Pink", value: "#ec4899" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Slate", value: "#64748b" },
  { name: "Gray", value: "#6b7280" },
  { name: "Zinc", value: "#71717a" },
  { name: "Stone", value: "#78716c" },
  { name: "Brown", value: "#92400e" },
  { name: "Navy", value: "#1e3a8a" },
];

interface CreateTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (tag: any) => void;
}

export function CreateTagDialog({ open, onOpenChange, onSuccess }: CreateTagDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0].value);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; color: string; createdBy: string }) => {
      const res = await apiRequest("POST", "/api/tags", data);
      return await res.json();
    },
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Tag created successfully" });
      setName("");
      setColor(PRESET_COLORS[0].value);
      onOpenChange(false);
      onSuccess?.(newTag);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create tag",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Tag name is required",
        variant: "destructive",
      });
      return;
    }
    if (!user?.id) {
      toast({
        title: "User not authenticated",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      color,
      createdBy: user.id,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Tag</DialogTitle>
          <DialogDescription>
            Create a new tag to organize your CRM entities
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Tag Name</Label>
              <Input
                id="tag-name"
                data-testid="input-tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter tag name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-color">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {PRESET_COLORS.map((presetColor) => (
                  <button
                    key={presetColor.value}
                    type="button"
                    onClick={() => setColor(presetColor.value)}
                    className={`w-10 h-10 rounded-md border-2 hover-elevate active-elevate-2 ${
                      color === presetColor.value
                        ? "border-foreground ring-2 ring-offset-2 ring-foreground"
                        : "border-border"
                    }`}
                    style={{ backgroundColor: presetColor.value }}
                    title={presetColor.name}
                    data-testid={`color-preset-${presetColor.value}`}
                  />
                ))}
                <Input
                  id="tag-color"
                  data-testid="input-tag-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 p-0 border-2 rounded-md cursor-pointer"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Selected: {color}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-tag"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-testid="button-create-tag"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
