import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EntityCombobox } from "./entity-combobox";
import { Label } from "@/components/ui/label";

export interface Association {
  entityType: string;
  entityId: string;
  displayName: string;
}

interface AssociationManagerProps {
  associations: Association[];
  onChange: (associations: Association[]) => void;
  className?: string;
}

export function AssociationManager({
  associations,
  onChange,
  className,
}: AssociationManagerProps) {
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = (entityId: string, entityType: string, displayName: string) => {
    // Check if association already exists
    const exists = associations.some(
      (a) => a.entityId === entityId && a.entityType === entityType
    );
    
    if (!exists) {
      onChange([...associations, { entityType, entityId, displayName }]);
    }
    setIsAdding(false);
  };

  const handleRemove = (index: number) => {
    const newAssociations = associations.filter((_, i) => i !== index);
    onChange(newAssociations);
  };

  return (
    <div className={className}>
      <Label>Associated Records</Label>
      <div className="mt-2 space-y-2">
        {associations.length > 0 && (
          <div className="space-y-2">
            {associations.map((assoc, index) => (
              <Card key={index} className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{assoc.entityType}</Badge>
                  <span className="text-sm">{assoc.displayName}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(index)}
                  data-testid={`button-remove-association-${index}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
        
        {isAdding ? (
          <div className="flex gap-2">
            <div className="flex-1">
              <EntityCombobox
                onChange={handleAdd}
                placeholder="Search for account, contact, lead, or opportunity..."
                testId="entity-combobox-add"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAdding(false)}
              data-testid="button-cancel-add-association"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsAdding(true)}
            className="w-full"
            data-testid="button-add-association"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Association
          </Button>
        )}
      </div>
    </div>
  );
}
