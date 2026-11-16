/** One plugin in a panel from the right: whether it works, what it adds, its settings and (for an added one) Remove. */
import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import type { PluginInfo } from "@shared/plugins";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useRemovePlugin } from "@/hooks/use-plugins";
import { cn } from "@/lib/utils";
import { InlineConfirm } from "../InlineConfirm";
import { PluginForm } from "./PluginForm";
import { pluginIcon } from "./plugin-icons";
import { StatusLine } from "./PluginStatus";
import { PluginSwitch } from "./PluginSwitch";

export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function RemovePlugin({ plugin, onRemoved }: { plugin: PluginInfo; onRemoved?: () => void }) {
  const [asking, setAsking] = useState(false);
  const remove = useRemovePlugin();
  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(true)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Trash2 className="h-3.5 w-3.5" /> Remove {plugin.name}
      </Button>
    );
  }
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <InlineConfirm action="Remove" pending={remove.isPending} error={remove.error} onConfirm={() => remove.mutate(plugin.id, { onSuccess: onRemoved })} onCancel={() => setAsking(false)}>
        Remove <strong>{plugin.name}</strong>? The assistant stops using its tools and its settings are deleted.
      </InlineConfirm>
    </div>
  );
}

export function PluginSheet({ plugin, canManage, onClose }: { plugin: PluginInfo | null; canManage: boolean; onClose: () => void }) {
  const Icon = plugin ? pluginIcon(plugin) : null;
  const live = plugin?.enabled && plugin.status.state === "ok";
  return (
    <Sheet open={plugin !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {plugin && Icon && (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3">
                <span aria-hidden className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", live ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base font-semibold">{plugin.name}</SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">{plugin.description}</SheetDescription>
                </div>
                {canManage && <PluginSwitch plugin={plugin} />}
              </div>
            </SheetHeader>
            <SheetBody>
              <StatusLine status={plugin.status} connects={plugin.fields.length > 0} />
              {(plugin.provides.features.length > 0 || plugin.provides.tools.length > 0) && (
                <SheetSection title="What it adds">
                  {plugin.provides.features.length > 0 && (
                    <ul className="space-y-1 text-sm">{plugin.provides.features.map((f) => <li key={f}>{f}</li>)}</ul>
                  )}
                  {plugin.provides.tools.length > 0 && (
                    <ul aria-label="Assistant tools" className="flex flex-wrap gap-1">
                      {plugin.provides.tools.map((t) => <li key={t} className="rounded-md border border-border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">{t}</li>)}
                    </ul>
                  )}
                </SheetSection>
              )}
              {canManage && plugin.fields.length > 0 && (
                <SheetSection title="Settings">
                  <PluginForm plugin={plugin} bare />
                </SheetSection>
              )}
              {!canManage && <p className="text-xs text-muted-foreground">Only a KubeDeck admin can switch it on or off and change its settings.</p>}
              {canManage && plugin.removable && <RemovePlugin plugin={plugin} onRemoved={onClose} />}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
