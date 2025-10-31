import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Send, Loader2, MoreVertical, Pin, MessageSquare, Trash2, Edit2, Check } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface Comment {
  id: string;
  entity: string;
  entityId: string;
  body: string;
  createdBy: string;
  createdAt: string;
  editedAt: string | null;
  editedBy: string | null;
  parentId: string | null;
  depth: number;
  isPinned: boolean;
  isResolved: boolean;
  mentions: any;
  createdByUser: { id: string; name: string; email: string };
  editedByUser: { id: string; name: string; email: string } | null;
  attachments: any[];
  reactions: Record<string, number>;
  replyCount: number;
  userReaction: string | null;
}

interface CommentSystemProps {
  entity: string;
  entityId: string;
  entityName?: string;
}

export function CommentSystem({ entity, entityId, entityName }: CommentSystemProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const { data: commentsData, isLoading } = useQuery<{
    comments: Comment[];
    pagination: any;
  }>({
    queryKey: ["/api", entity, entityId, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/${entity}/${entityId}/comments`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load comments");
      return res.json();
    },
  });

  const createCommentMutation = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId?: string }) => {
      const res = await apiRequest("POST", `/api/${entity}/${entityId}/comments`, {
        body,
        parentId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
      setNewComment("");
      setReplyTo(null);
      toast({ title: "Comment posted" });
    },
    onError: () => {
      toast({ title: "Failed to post comment", variant: "destructive" });
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: string; body: string }) => {
      const res = await apiRequest("PATCH", `/api/${entity}/${entityId}/comments/${commentId}`, {
        body,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
      setEditingComment(null);
      setEditBody("");
      toast({ title: "Comment updated" });
    },
    onError: () => {
      toast({ title: "Failed to update comment", variant: "destructive" });
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: async (commentId: string) => {
      await apiRequest("DELETE", `/api/${entity}/${entityId}/comments/${commentId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
      toast({ title: "Comment deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete comment", variant: "destructive" });
    },
  });

  const togglePinMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await apiRequest("POST", `/api/${entity}/${entityId}/comments/${commentId}/pin`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
      toast({ title: "Comment pin toggled" });
    },
    onError: () => {
      toast({ title: "Failed to toggle pin", variant: "destructive" });
    },
  });

  const toggleResolveMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await apiRequest("POST", `/api/${entity}/${entityId}/comments/${commentId}/resolve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
      toast({ title: "Comment resolution toggled" });
    },
    onError: () => {
      toast({ title: "Failed to toggle resolution", variant: "destructive" });
    },
  });

  const reactMutation = useMutation({
    mutationFn: async ({ commentId, emoji }: { commentId: string; emoji: string }) => {
      const res = await apiRequest("POST", `/api/${entity}/${entityId}/comments/${commentId}/reactions`, {
        emoji,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api", entity, entityId, "comments"] });
    },
    onError: () => {
      toast({ title: "Failed to react", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    createCommentMutation.mutate({ body: newComment });
  };

  const handleReply = (parentId: string) => {
    if (!newComment.trim()) return;
    createCommentMutation.mutate({ body: newComment, parentId });
  };

  const handleEdit = (commentId: string) => {
    if (!editBody.trim()) return;
    updateCommentMutation.mutate({ commentId, body: editBody });
  };

  const startEdit = (comment: Comment) => {
    setEditingComment(comment.id);
    setEditBody(comment.body);
  };

  const cancelEdit = () => {
    setEditingComment(null);
    setEditBody("");
  };

  const comments = commentsData?.comments || [];
  const topLevelComments = comments.filter((c) => !c.parentId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">
          Comments {entityName && <span className="text-muted-foreground">• {entityName}</span>}
        </h3>
        <p className="text-sm text-muted-foreground">
          {comments.length} {comments.length === 1 ? "comment" : "comments"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <Textarea
          placeholder="Write a comment..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          className="min-h-[80px]"
          data-testid="input-new-comment"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!newComment.trim() || createCommentMutation.isPending}
            data-testid="button-submit-comment"
          >
            {createCommentMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Post Comment
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {topLevelComments.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No comments yet. Be the first to comment!</p>
        )}
        {topLevelComments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            allComments={comments}
            entity={entity}
            entityId={entityId}
            user={user}
            replyTo={replyTo}
            setReplyTo={setReplyTo}
            newComment={newComment}
            setNewComment={setNewComment}
            editingComment={editingComment}
            editBody={editBody}
            setEditBody={setEditBody}
            onReply={handleReply}
            onEdit={handleEdit}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onDelete={(id) => deleteCommentMutation.mutate(id)}
            onTogglePin={(id) => togglePinMutation.mutate(id)}
            onToggleResolve={(id) => toggleResolveMutation.mutate(id)}
            onReact={(id, emoji) => reactMutation.mutate({ commentId: id, emoji })}
          />
        ))}
      </div>
    </div>
  );
}

interface CommentItemProps {
  comment: Comment;
  allComments: Comment[];
  entity: string;
  entityId: string;
  user: any;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  newComment: string;
  setNewComment: (text: string) => void;
  editingComment: string | null;
  editBody: string;
  setEditBody: (text: string) => void;
  onReply: (parentId: string) => void;
  onEdit: (commentId: string) => void;
  onStartEdit: (comment: Comment) => void;
  onCancelEdit: () => void;
  onDelete: (commentId: string) => void;
  onTogglePin: (commentId: string) => void;
  onToggleResolve: (commentId: string) => void;
  onReact: (commentId: string, emoji: string) => void;
}

function CommentItem({
  comment,
  allComments,
  user,
  replyTo,
  setReplyTo,
  newComment,
  setNewComment,
  editingComment,
  editBody,
  setEditBody,
  onReply,
  onEdit,
  onStartEdit,
  onCancelEdit,
  onDelete,
  onTogglePin,
  onToggleResolve,
  onReact,
}: CommentItemProps) {
  const isOwner = user?.id === comment.createdBy;
  const isEditing = editingComment === comment.id;
  const isReplying = replyTo === comment.id;
  const replies = allComments.filter((c) => c.parentId === comment.id);

  const reactionEmojis = ["👍", "❤️", "🎉", "👀", "🚀"];

  return (
    <Card className="p-4" data-testid={`comment-${comment.id}`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback>{comment.createdByUser.name.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{comment.createdByUser.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
                {comment.editedAt && (
                  <span className="text-xs text-muted-foreground">(edited)</span>
                )}
                {comment.isPinned && (
                  <Badge variant="secondary" className="text-xs">
                    <Pin className="h-3 w-3 mr-1" />
                    Pinned
                  </Badge>
                )}
                {comment.isResolved && (
                  <Badge variant="secondary" className="text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    Resolved
                  </Badge>
                )}
              </div>
              {isEditing ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    className="min-h-[60px]"
                    data-testid={`input-edit-comment-${comment.id}`}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onEdit(comment.id)} data-testid={`button-save-edit-${comment.id}`}>
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={onCancelEdit} data-testid={`button-cancel-edit-${comment.id}`}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-sm text-foreground whitespace-pre-wrap break-words">{comment.body}</p>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" data-testid={`button-comment-menu-${comment.id}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOwner && !isEditing && (
                <DropdownMenuItem onClick={() => onStartEdit(comment)} data-testid={`menu-edit-${comment.id}`}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onTogglePin(comment.id)} data-testid={`menu-pin-${comment.id}`}>
                <Pin className="h-4 w-4 mr-2" />
                {comment.isPinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onToggleResolve(comment.id)} data-testid={`menu-resolve-${comment.id}`}>
                <Check className="h-4 w-4 mr-2" />
                {comment.isResolved ? "Unresolve" : "Resolve"}
              </DropdownMenuItem>
              {isOwner && (
                <DropdownMenuItem
                  onClick={() => onDelete(comment.id)}
                  className="text-destructive"
                  data-testid={`menu-delete-${comment.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              {reactionEmojis.map((emoji) => (
                <Button
                  key={emoji}
                  variant={comment.userReaction === emoji ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => onReact(comment.id, emoji)}
                  data-testid={`button-react-${emoji}-${comment.id}`}
                >
                  <span className="text-base">{emoji}</span>
                  {comment.reactions[emoji] > 0 && (
                    <span className="ml-1 text-xs">{comment.reactions[emoji]}</span>
                  )}
                </Button>
              ))}
            </div>
            {comment.depth < 2 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setReplyTo(isReplying ? null : comment.id)}
                data-testid={`button-reply-${comment.id}`}
              >
                <MessageSquare className="h-3 w-3 mr-1" />
                Reply {comment.replyCount > 0 && `(${comment.replyCount})`}
              </Button>
            )}
          </div>
        )}

        {isReplying && (
          <div className="ml-11 space-y-2">
            <Textarea
              placeholder="Write a reply..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              className="min-h-[60px]"
              data-testid={`input-reply-${comment.id}`}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onReply(comment.id)} data-testid={`button-submit-reply-${comment.id}`}>
                Post Reply
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReplyTo(null)} data-testid={`button-cancel-reply-${comment.id}`}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {replies.length > 0 && (
          <div className="ml-11 space-y-3 pt-3 border-l-2 border-border pl-4">
            {replies.map((reply) => (
              <div key={reply.id} className="space-y-2" data-testid={`reply-${reply.id}`}>
                <div className="flex items-start gap-2">
                  <Avatar className="h-6 w-6 flex-shrink-0">
                    <AvatarFallback className="text-xs">
                      {reply.createdByUser.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs">{reply.createdByUser.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground whitespace-pre-wrap break-words">{reply.body}</p>
                    <div className="flex items-center gap-1 mt-2">
                      {reactionEmojis.map((emoji) => (
                        <Button
                          key={emoji}
                          variant={reply.userReaction === emoji ? "secondary" : "ghost"}
                          size="sm"
                          className="h-6 px-1.5"
                          onClick={() => onReact(reply.id, emoji)}
                          data-testid={`button-react-${emoji}-${reply.id}`}
                        >
                          <span className="text-sm">{emoji}</span>
                          {reply.reactions[emoji] > 0 && (
                            <span className="ml-1 text-xs">{reply.reactions[emoji]}</span>
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
