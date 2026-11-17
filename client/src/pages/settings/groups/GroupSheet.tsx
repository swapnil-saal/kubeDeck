/** Creating a group, or changing its name, description and cluster access, in a panel from the right. */
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { ALL_PERMISSIONS, APP_PERMISSIONS, type AppPermissions, type ClusterAccess, type Group } from "@shared/groups";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCreateGroup, useUpdateGroup } from "@/hooks/use-groups";
import { field, Labeled } from "../users/user-fields";
import { AccessEditor, accessIncomplete as incomplete } from "./AccessEditor";

/** `group` set: edit it; null: a new group. `onSaved` gets the saved group's id. */
export function GroupSheet({ open, group, onClose, onSaved }: {
  open: boolean;
  group: Group | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const create = useCreateGroup();
  const update = useUpdateGroup();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ClusterAccess[]>([]);
  const [permissions, setPermissions] = useState<AppPermissions>(ALL_PERMISSIONS);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setAccess(group?.access ?? []);
    setPermissions(group?.permissions ?? ALL_PERMISSIONS);
    create.reset();
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.id]);

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;
  const done = (g: Group) => { onSaved?.(g.id); onClose(); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (group) update.mutate({ id: group.id, name, description, access, permissions }, { onSuccess: done });
    else create.mutate({ name, description, access, permissions }, { onSuccess: done });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="sm:max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            <SheetTitle className="text-base font-semibold">{group ? `Edit ${group.name}` : "New group"}</SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              {group ? <>Id <code className="font-mono">{group.id}</code>; people's accounts carry it.</> : "A team, and the service account its people use on each cluster."}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Name" hint={group ? undefined : "e.g. Developers"}><Input required value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus={!group} /></Labeled>
              <Labeled label="Description" hint="optional"><Input value={description} onChange={(e) => setDescription(e.target.value)} className={field} /></Labeled>
            </div>
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cluster access<span className="ml-2 font-normal normal-case tracking-normal">one service account per cluster</span>
              </h3>
              <AccessEditor value={access} onChange={setAccess} />
            </section>
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                KubeDeck permissions<span className="ml-2 font-normal normal-case tracking-normal">what people in this group may use in KubeDeck</span>
              </h3>
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {APP_PERMISSIONS.map((p) => (
                  <li key={p.key}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{p.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{p.help}</span>
                      </span>
                      <Switch checked={permissions[p.key]} onCheckedChange={(on) => setPermissions((x) => ({ ...x, [p.key]: on }))} aria-label={p.label} />
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Someone in several groups gets a feature if any of them allows it. What they may do in a cluster (delete, scale, exec) is the
                service account's Kubernetes RBAC, not a switch here. Admins always have everything.
              </p>
            </section>
          </SheetBody>
          <SheetFooter>
            {error && <p role="alert" className="w-full text-xs text-destructive">{error.message}</p>}
            <Button type="submit" size="sm" disabled={pending || !name.trim() || incomplete(access)}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {group ? "Save changes" : "Create group"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            {incomplete(access) && <span className="ml-auto text-[11px] text-muted-foreground">Pick a service account or upload a kubeconfig for each cluster.</span>}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
