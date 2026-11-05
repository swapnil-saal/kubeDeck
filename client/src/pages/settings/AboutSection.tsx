import { ExternalLink } from "lucide-react";
import { KubeDeckLogo } from "@/components/KubeDeckLogo";
import { useServerMode } from "@/hooks/use-server-mode";
import { SettingsCard } from "./SettingsCard";

const SHORTCUTS: [string, string][] = [
  ["⌘ K", "Run kubectl, or describe what you want"],
  ["⌘ B", "Collapse or expand the sidebar"],
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2">
      <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm text-foreground">{children}</span>
    </div>
  );
}

export function AboutSection() {
  const mode = useServerMode();
  return (
    <div className="space-y-6">
      <SettingsCard title="About KubeDeck">
        <KubeDeckLogo size="xl" />
        <div className="mt-3 divide-y divide-border/60">
          <Row label="Version"><span className="font-mono tabular-nums">{__APP_VERSION__}</span></Row>
          <Row label="Running as">{mode.mode === "web" ? `shared web service${mode.readOnly ? " (read-only)" : ""}${mode.auth === "none" ? ", no sign-in" : ""}` : "desktop app"}</Row>
          {mode.mode === "web" && (
            <Row label="Permissions">{mode.access === "user" ? "your own Kubernetes permissions" : "shared: KubeDeck's service account"}</Row>
          )}
          <Row label="Settings">
            {mode.mode === "web" ? "managed by the server's environment" : <span className="font-mono text-xs">~/.kubedeck/settings.json</span>}
          </Row>
          {__APP_HOMEPAGE__ && (
            <Row label="Source">
              <a href={__APP_HOMEPAGE__} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                {__APP_HOMEPAGE__.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
              </a>
            </Row>
          )}
          <Row label="License">MIT</Row>
        </div>
      </SettingsCard>

      <SettingsCard title="Keyboard shortcuts">
        <dl className="divide-y divide-border/60">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys} className="flex items-center gap-4 py-2">
              <dt className="w-28 shrink-0"><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{keys}</kbd></dt>
              <dd className="text-sm text-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
    </div>
  );
}
