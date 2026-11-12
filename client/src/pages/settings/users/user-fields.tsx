/** The small pieces the user forms share: a labelled field, the password field, the role picker. */
import type { ReactNode } from "react";
import { Wand2 } from "lucide-react";
import type { Role } from "@shared/admin";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const field = "h-9 rounded-lg border-border bg-muted/50 text-sm focus-visible:ring-primary/20";

/** "shop-editors, viewers" → ["shop-editors", "viewers"] (the server validates each one) */
export const parseGroups = (raw: string) => raw.split(/[\s,]+/).map((g) => g.trim().toLowerCase()).filter(Boolean);

/** 24 random characters, for an admin who does not want to invent a password */
export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium">
        {label}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-w-0 gap-2">
      <Input id={id} type="text" autoComplete="new-password" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className={cn(field, "min-w-0 font-mono")} />
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(generatePassword())} title="Make a random password" aria-label="Generate a random password" className="h-9 shrink-0">
        <Wand2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Generate</span>
      </Button>
      {value && <CopyButton text={value} title="Copy the password" className="shrink-0" />}
    </div>
  );
}

export function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)} className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm disabled:opacity-60">
      <option value="user">User</option>
      <option value="admin">Admin: also manages users</option>
    </select>
  );
}
