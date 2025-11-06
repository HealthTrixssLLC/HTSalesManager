import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
}

export function TagBadge({ tag, onRemove }: TagBadgeProps) {
  return (
    <Badge
      data-testid={`tag-badge-${tag.id}`}
      className="gap-1 pl-2"
      style={{
        backgroundColor: tag.color,
        color: getContrastColor(tag.color),
        borderColor: tag.color,
      }}
    >
      <span>{tag.name}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-1 rounded-sm opacity-70 hover:opacity-100 focus:outline-none"
          data-testid={`button-remove-tag-${tag.id}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}
