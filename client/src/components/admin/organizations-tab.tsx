import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Users, ChevronDown, ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Role } from "@shared/schema";

type OrgSetting = {
  annualSalesTargets?: Record<string, number>;
};

type Org = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  settings: OrgSetting;
  createdAt: string;
  updatedAt: string;
};

type OrgMember = {
  id: string;
  userId: string;
  organizationId: string;
  roleId: string;
  isDefault: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; status: string };
  roleName: string;
};

type UserRow = { id: string; name: string; email: string };

const CURRENT_YEAR = new Date().getFullYear();

function OrgForm({
  org,
  onClose,
  onSaved,
}: {
  org?: Org;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(org?.name || "");
  const [slug, setSlug] = useState(org?.slug || "");
  const [description, setDescription] = useState(org?.description || "");
  const [logoUrl, setLogoUrl] = useState(org?.logoUrl || "");
  const [salesTarget, setSalesTarget] = useState(
    org?.settings?.annualSalesTargets?.[CURRENT_YEAR.toString()]
      ? String(org.settings.annualSalesTargets[CURRENT_YEAR.toString()])
      : ""
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settings: OrgSetting = {
        annualSalesTargets: {
          ...(org?.settings?.annualSalesTargets || {}),
          ...(salesTarget ? { [CURRENT_YEAR.toString()]: Number(salesTarget) } : {}),
        },
      };
      const body = { name, slug, description: description || null, logoUrl: logoUrl || null, settings };
      if (org) {
        await apiRequest("PUT", `/api/organizations/${org.id}`, body);
      } else {
        await apiRequest("POST", "/api/organizations", body);
      }
    },
    onSuccess: () => {
      toast({ title: org ? "Organization updated" : "Organization created" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/organizations"] });
      onSaved();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const autoSlug = (val: string) =>
    val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{org ? "Edit Organization" : "New Organization"}</DialogTitle>
        <DialogDescription>Configure organization settings</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-1">
          <Label htmlFor="org-name">Name</Label>
          <Input
            id="org-name"
            data-testid="input-org-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!org) setSlug(autoSlug(e.target.value));
            }}
            placeholder="Acme Corp"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-slug">Slug</Label>
          <Input
            id="org-slug"
            data-testid="input-org-slug"
            value={slug}
            onChange={(e) => setSlug(autoSlug(e.target.value))}
            placeholder="acme-corp"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-desc">Description</Label>
          <Textarea
            id="org-desc"
            data-testid="input-org-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-logo">Logo URL</Label>
          <Input
            id="org-logo"
            data-testid="input-org-logo"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="org-target">Annual Sales Target ({CURRENT_YEAR})</Label>
          <Input
            id="org-target"
            data-testid="input-org-sales-target"
            type="number"
            value={salesTarget}
            onChange={(e) => setSalesTarget(e.target.value)}
            placeholder="1000000"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !name || !slug}
          data-testid="button-save-org"
        >
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function OrgMembers({ org, roles, users }: { org: Org; roles: Role[]; users: UserRow[] }) {
  const { toast } = useToast();
  const [addingUser, setAddingUser] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [newRoleId, setNewRoleId] = useState("");

  const { data: members = [] } = useQuery<OrgMember[]>({
    queryKey: ["/api/organizations", org.id, "members"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/organizations/${org.id}/members`);
      return res.json();
    },
  });

  const addMember = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/organizations/${org.id}/members`, { userId: newUserId, roleId: newRoleId });
    },
    onSuccess: () => {
      toast({ title: "Member added" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", org.id, "members"] });
      setAddingUser(false);
      setNewUserId("");
      setNewRoleId("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, roleId }: { userId: string; roleId: string }) => {
      await apiRequest("PUT", `/api/organizations/${org.id}/members/${userId}`, { roleId });
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", org.id, "members"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/organizations/${org.id}/members/${userId}`);
    },
    onSuccess: () => {
      toast({ title: "Member removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", org.id, "members"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const memberUserIds = new Set(members.map((m) => m.userId));
  const availableUsers = users.filter((u) => !memberUserIds.has(u.id));

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Members</h4>
        <Button size="sm" variant="outline" onClick={() => setAddingUser(true)} data-testid="button-add-member">
          <Plus className="h-3 w-3 mr-1" /> Add Member
        </Button>
      </div>

      {addingUser && (
        <div className="flex items-center gap-2 p-3 border rounded-md bg-muted/30">
          <Select value={newUserId} onValueChange={setNewUserId}>
            <SelectTrigger className="flex-1" data-testid="select-member-user">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {availableUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name} ({u.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={newRoleId} onValueChange={setNewRoleId}>
            <SelectTrigger className="w-36" data-testid="select-member-role">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => addMember.mutate()}
            disabled={!newUserId || !newRoleId || addMember.isPending}
            data-testid="button-confirm-add-member"
          >
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAddingUser(false)}>Cancel</Button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1">
                    {m.user.name}
                    {m.isDefault && <Star className="h-3 w-3 text-amber-500" />}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{m.user.email}</TableCell>
                <TableCell>
                  <Select
                    value={m.roleId}
                    onValueChange={(roleId) => changeRole.mutate({ userId: m.userId, roleId })}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs" data-testid={`select-role-${m.userId}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeMember.mutate(m.userId)}
                    data-testid={`button-remove-member-${m.userId}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function OrganizationsTab() {
  const { toast } = useToast();
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrg, setEditOrg] = useState<Org | null>(null);

  const { data: orgs = [], isLoading } = useQuery<Org[]>({
    queryKey: ["/api/organizations/all"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/organizations/all");
      return res.json();
    },
  });

  const { data: roles = [] } = useQuery<Role[]>({ queryKey: ["/api/admin/roles"] });
  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["/api/users"],
  });

  const deleteOrg = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/organizations/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Organization deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/organizations"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>Manage organizations and their members</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-org">
            <Plus className="h-4 w-4 mr-1" /> New Organization
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading organizations...</div>
        ) : orgs.length === 0 ? (
          <div className="text-sm text-muted-foreground">No organizations found.</div>
        ) : (
          <div className="space-y-2">
            {orgs.map((org) => {
              const isExpanded = expandedOrgId === org.id;
              const target = org.settings?.annualSalesTargets?.[CURRENT_YEAR.toString()];
              return (
                <div key={org.id} className="border rounded-md overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover-elevate"
                    onClick={() => setExpandedOrgId(isExpanded ? null : org.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{org.name}</span>
                        <Badge variant="outline" className="text-xs">{org.slug}</Badge>
                        {target && (
                          <Badge variant="secondary" className="text-xs">
                            Target {CURRENT_YEAR}: ${target.toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      {org.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{org.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); setEditOrg(org); }}
                        data-testid={`button-edit-org-${org.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteOrg.mutate(org.id); }}
                        data-testid={`button-delete-org-${org.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t bg-muted/10">
                      <OrgMembers org={org} roles={roles} users={users} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Create org dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <OrgForm onClose={() => setCreateOpen(false)} onSaved={() => {}} />
      </Dialog>

      {/* Edit org dialog */}
      <Dialog open={!!editOrg} onOpenChange={(open) => { if (!open) setEditOrg(null); }}>
        {editOrg && <OrgForm org={editOrg} onClose={() => setEditOrg(null)} onSaved={() => {}} />}
      </Dialog>
    </Card>
  );
}
