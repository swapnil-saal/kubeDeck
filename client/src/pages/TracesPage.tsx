import { useState, type FormEvent } from "react";
import { useLocation, useRoute } from "wouter";
import { Search } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { OverviewViews } from "@/components/OverviewViews";
import { TraceExplorer, TracingUnavailable } from "@/components/traces/TraceExplorer";
import { TraceWaterfall } from "@/components/traces/TraceWaterfall";
import { useScope } from "@/hooks/use-scope";
import { useScopeFromUrl } from "@/hooks/use-scope-from-url";
import { useTraceStatus } from "@/hooks/use-traces";

const TRACE_ID = /^[0-9a-f]{16,32}$/i;

/** Jump straight to a trace id (from a log line, an alert, a colleague). */
function TraceIdLookup({ context }: { context: string }) {
  const [, navigate] = useLocation();
  const [id, setId] = useState("");
  const valid = TRACE_ID.test(id.trim());
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (valid) navigate(`/trace/${id.trim().toLowerCase()}?context=${encodeURIComponent(context)}`);
  };
  return (
    <form onSubmit={go} className="hidden md:block">
      <label className="relative block">
        <span className="sr-only">Open a trace by id</span>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Trace id"
          spellCheck={false}
          title={valid ? "Press Enter to open" : "Paste a 32-character trace id"}
          className="h-9 w-40 rounded-lg border border-border bg-background pl-7 pr-2 font-mono text-xs outline-none focus:w-64 focus:border-primary/50"
        />
      </label>
    </form>
  );
}

/** `/traces` — requests, errors and latency per service in the selected namespace, and the traces behind them. */
export default function TracesPage() {
  useScopeFromUrl();
  const { context, namespace } = useScope();
  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Traces" }]} rightSlot={<><TraceIdLookup context={context} /><OverviewViews /></>} />
      <main className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-7">
        <TraceExplorer context={context} namespace={namespace} className="mx-auto max-w-7xl" />
      </main>
    </div>
  );
}

/** `/trace/:id` — one trace on its own page (a link to share, or to open from a log line). */
export function TracePage() {
  const [, params] = useRoute("/trace/:id");
  useScopeFromUrl({ keepInUrl: true });
  const { context, namespace } = useScope();
  const status = useTraceStatus(context, namespace);
  const id = params?.id ?? "";
  return (
    <div className="flex h-full flex-col overflow-hidden text-foreground">
      <AppHeader showSelectors={false} breadcrumbs={[{ label: "Overview", href: "/" }, { label: "Traces", href: "/traces" }, { label: id.slice(0, 12) || "Trace" }]} />
      <div className="min-h-0 flex-1 p-3 sm:p-5">
        <div className="h-full overflow-hidden rounded-xl border border-border bg-card">
          {status.data && !status.data.configured ? (
            <TracingUnavailable configured={false} />
          ) : (
            <TraceWaterfall traceId={id} context={context} grafanaTraceUrl={status.data?.grafanaTraceUrl} logs={!!status.data?.logs} showOpenFull={false} />
          )}
        </div>
      </div>
    </div>
  );
}
