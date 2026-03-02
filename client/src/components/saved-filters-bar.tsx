import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ChevronDown, Plus, Star, Trash2, Edit3, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, fetchCsrfToken } from "@/lib/queryClient";
import type { SavedFilter } from "@shared/schema";

interface SavedFiltersBarProps {
  pageName: string;
  currentFilters: Record<string, any>;
  onApply: (filters: Record<string, any>) => void;
  hasActiveFilters: boolean;
}

export function SavedFiltersBar({ pageName, currentFilters, onApply, hasActiveFilters }: SavedFiltersBarProps) {
  const { toast } = useToast();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const defaultApplied = useRef(false);

  const { data: presets = [] } = useQuery<SavedFilter[]>({
    queryKey: ["/api/saved-filters", pageName],
    queryFn: async () => {
      const res = await fetch(`/api/saved-filters?page=${pageName}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Auto-apply default preset on first load only if no active filters
  useEffect(() => {
    if (defaultApplied.current) return;
    if (presets.length === 0) return;
    if (hasActiveFilters) {
      defaultApplied.current = true;
      return;
    }
    const defaultPreset = presets.find((p) => p.isDefault);
    if (defaultPreset) {
      defaultApplied.current = true;
      setActivePresetId(defaultPreset.id);
      onApply(defaultPreset.filters as Record<string, any>);
    }
  }, [presets]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; isDefault: boolean }) => {
      const res = await apiRequest("POST", "/api/saved-filters", {
        pageName,
        name: data.name,
        filters: currentFilters,
        isDefault: data.isDefault,
      });
      return res.json();
    },
    onSuccess: (created: SavedFilter) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", pageName] });
      setActivePresetId(created.id);
      setSaveDialogOpen(false);
      setSaveName("");
      setSaveAsDefault(false);
      toast({ title: "Filter preset saved" });
    },
    onError: () => toast({ title: "Failed to save preset", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, isDefault }: { id: string; name?: string; isDefault?: boolean }) => {
      const res = await apiRequest("PUT", `/api/saved-filters/${id}`, { name, isDefault });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", pageName] });
      setRenameId(null);
      toast({ title: "Preset updated" });
    },
    onError: () => toast({ title: "Failed to update preset", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-filters/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters", pageName] });
      if (activePresetId === id) setActivePresetId(null);
      toast({ title: "Preset deleted" });
    },
    onError: () => toast({ title: "Failed to delete preset", variant: "destructive" }),
  });

  const handleApplyPreset = (preset: SavedFilter) => {
    setActivePresetId(preset.id);
    onApply(preset.filters as Record<string, any>);
  };

  const handleSetDefault = (preset: SavedFilter) => {
    updateMutation.mutate({ id: preset.id, isDefault: !preset.isDefault });
  };

  const handleStartRename = (preset: SavedFilter) => {
    setRenameId(preset.id);
    setRenameName(preset.name);
  };

  const handleConfirmRename = () => {
    if (renameId && renameName.trim()) {
      updateMutation.mutate({ id: renameId, name: renameName.trim() });
    }
  };

  if (presets.length === 0 && !saveDialogOpen) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground gap-1.5"
          onClick={() => setSaveDialogOpen(true)}
          data-testid="button-save-filter-preset"
        >
          <Bookmark className="h-3.5 w-3.5" />
          Save current filters
        </Button>
        <SaveDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          saveName={saveName}
          setSaveName={setSaveName}
          saveAsDefault={saveAsDefault}
          setSaveAsDefault={setSaveAsDefault}
          onSave={() => createMutation.mutate({ name: saveName, isDefault: saveAsDefault })}
          isPending={createMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground font-medium shrink-0">Saved:</span>

      {presets.map((preset) =>
        renameId === preset.id ? (
          <div key={preset.id} className="flex items-center gap-1">
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirmRename(); if (e.key === "Escape") setRenameId(null); }}
              className="h-6 text-xs w-32 px-2"
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleConfirmRename}><Check className="h-3 w-3" /></Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRenameId(null)}><X className="h-3 w-3" /></Button>
          </div>
        ) : (
          <div key={preset.id} className="flex items-center gap-0.5">
            <Badge
              variant={activePresetId === preset.id ? "default" : "outline"}
              className="cursor-pointer text-xs h-6 gap-1 rounded-md pr-1 no-default-active-elevate"
              onClick={() => handleApplyPreset(preset)}
              data-testid={`badge-preset-${preset.id}`}
            >
              {preset.isDefault && <Star className="h-2.5 w-2.5 fill-current" />}
              {preset.name}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-4 rounded-sm opacity-50 hover:opacity-100" data-testid={`button-preset-menu-${preset.id}`}>
                  <ChevronDown className="h-2.5 w-2.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuItem onClick={() => handleSetDefault(preset)}>
                  <Star className="h-3.5 w-3.5 mr-2" />
                  {preset.isDefault ? "Remove default" : "Set as default"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStartRename(preset)}>
                  <Edit3 className="h-3.5 w-3.5 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => deleteMutation.mutate(preset.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs text-muted-foreground gap-1 px-2"
        onClick={() => setSaveDialogOpen(true)}
        data-testid="button-save-filter-preset"
      >
        <Plus className="h-3 w-3" />
        Save
      </Button>

      <SaveDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        saveName={saveName}
        setSaveName={setSaveName}
        saveAsDefault={saveAsDefault}
        setSaveAsDefault={setSaveAsDefault}
        onSave={() => createMutation.mutate({ name: saveName, isDefault: saveAsDefault })}
        isPending={createMutation.isPending}
      />
    </div>
  );
}

function SaveDialog({
  open, onOpenChange, saveName, setSaveName, saveAsDefault, setSaveAsDefault, onSave, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saveName: string;
  setSaveName: (v: string) => void;
  saveAsDefault: boolean;
  setSaveAsDefault: (v: boolean) => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save Filter Preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="preset-name">Preset name</Label>
            <Input
              id="preset-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Hot Opportunities Q2"
              onKeyDown={(e) => { if (e.key === "Enter" && saveName.trim()) onSave(); }}
              data-testid="input-preset-name"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="set-default"
              checked={saveAsDefault}
              onCheckedChange={(v) => setSaveAsDefault(!!v)}
              data-testid="checkbox-set-default"
            />
            <Label htmlFor="set-default" className="text-sm cursor-pointer">
              Set as default for this page
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Default presets are automatically applied when you open this page.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={!saveName.trim() || isPending} data-testid="button-confirm-save-preset">
            <BookmarkCheck className="h-4 w-4 mr-2" />
            {isPending ? "Saving..." : "Save Preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
