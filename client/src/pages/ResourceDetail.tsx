import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useHashParams } from "@/hooks/use-hash-params";
import {
  useResourceDescribe, useResourceYaml, useResourceEvents,
  usePodLogs, usePodEnv, useStreamingLogs, useResourceRelated,
  usePortForward, usePortForwards, useStopPortForward, useApplyYaml,
  useDeploymentLogs,
} from "@/hooks/use-k8s";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, Code, ScrollText, Search,
  Terminal, Variable, Wifi, WifiOff, Copy, Check, GitBranch,
  Box, Layers, Network, Share2, Square, ExternalLink, Save, Pencil,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildDescribeCommand } from "@/components/CommandBar";

const TYPE_META: Record<string, { label: string }> = {
  pod: { label: "POD" }, deployment: { label: "DEPLOYMENT" }, service: { label: "SERVICE" },
  configmap: { label: "CONFIGMAP" }, secret: { label: "SECRET" }, ingress: { label: "INGRESS" },
  statefulset: { label: "STATEFULSET" }, daemonset: { label: "DAEMONSET" }, job: { label: "JOB" },
  cronjob: { label: "CRONJOB" }, node: { label: "NODE" }, hpa: { label: "HPA" }, pvc: { label: "PVC" },
};

/* ── Helpers ─────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-foreground transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-foreground/60" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function TerminalPane({ content, isLoading, emptyMsg = "No data" }: {
  content?: string; isLoading: boolean; emptyMsg?: string;
}) {
  return (
    <div className="relative h-full">
      {content && <div className="absolute top-2 right-2 z-10"><CopyButton text={content} /></div>}
      <div className="h-full overflow-auto p-4 bg-surface-inset rounded border border-border">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground font-mono text-[12px]">
            <span className="inline-block w-2 h-4 bg-foreground/20 animate-pulse" />
            <span className="animate-pulse">executing...</span>
          </div>
        ) : content ? (
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground/70">{content}</pre>
        ) : (
          <p className="text-[11px] text-muted-foreground font-mono">{emptyMsg}</p>
        )}
      </div>
    </div>
  );
}

/* ── YAML Viewer with syntax highlighting ────────── */

function YamlViewer({ content, isLoading }: { content?: string; isLoading: boolean }) {
  const highlighted = useMemo(() => {
    if (!content) return [];
    return content.split("\n").map((line) => {
      const commentMatch = line.match(/^(\s*)(#.*)$/);
      if (commentMatch) return { indent: commentMatch[1], type: "comment" as const, text: commentMatch[2] };

      const kvMatch = line.match(/^(\s*)([\w.\-/]+)(\s*:\s*)(.*)$/);
      if (kvMatch) return { indent: kvMatch[1], type: "kv" as const, key: kvMatch[2], sep: kvMatch[3], value: kvMatch[4] };

      const listMatch = line.match(/^(\s*)(- )(.*)$/);
      if (listMatch) return { indent: listMatch[1], type: "list" as const, dash: listMatch[2], rest: listMatch[3] };

      return { type: "plain" as const, text: line };
    });
  }, [content]);

  if (isLoading) return <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-[11px] animate-pulse">Loading YAML...</div>;
  if (!content) return <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-[11px]">No YAML data</div>;

  return (
    <div className="relative h-full">
      <div className="absolute top-2 right-2 z-10"><CopyButton text={content} /></div>
      <div className="h-full overflow-auto p-4 bg-surface-inset rounded border border-border font-mono text-[11px] leading-relaxed">
        {highlighted.map((line, i) => (
          <div key={i} className="hover:bg-foreground/[0.02] flex">
            <span className="text-muted-foreground/40 select-none mr-3 inline-block w-10 text-right tabular-nums shrink-0">{i + 1}</span>
            <span className="whitespace-pre">
              {line.type === "comment" && <><span>{line.indent}</span><span className="text-muted-foreground/50">{line.text}</span></>}
              {line.type === "kv" && <><span>{line.indent}</span><span className="text-foreground/80">{line.key}</span><span className="text-muted-foreground">{line.sep}</span><span className="text-foreground/60">{line.value}</span></>}
              {line.type === "list" && <><span>{line.indent}</span><span className="text-muted-foreground">{line.dash}</span><span className="text-foreground/60">{line.rest}</span></>}
              {line.type === "plain" && <span className="text-foreground/60">{line.text}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Env Viewer: table format ────────────────────── */

function EnvViewer({ content, isLoading }: { content?: string; isLoading: boolean }) {
  const [filter, setFilter] = useState("");
  const entries = useMemo(() => {
    if (!content) return [];
    return content.split("\n").filter(Boolean).map((line) => {
      const idx = line.indexOf("=");
      if (idx === -1) return { key: line, value: "" };
      return { key: line.slice(0, idx), value: line.slice(idx + 1) };
    });
  }, [content]);

  const filtered = useMemo(() => {
    if (!filter) return entries;
    const lower = filter.toLowerCase();
    return entries.filter(e => e.key.toLowerCase().includes(lower) || e.value.toLowerCase().includes(lower));
  }, [entries, filter]);

  if (isLoading) return <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-[11px] animate-pulse">Loading env...</div>;
  if (!content) return <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-[11px]">No environment data (pod may not be running)</div>;

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter env vars..."
            className="w-full h-7 pl-8 pr-3 bg-card border border-border rounded-md text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/20 transition-all" />
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums">{filtered.length}/{entries.length} vars</span>
        <CopyButton text={content} />
      </div>
      <div className="flex-1 overflow-auto rounded border border-border bg-surface-inset">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead>
            <tr className="border-b border-border bg-foreground/[0.03]">
              <th className="px-3 py-1.5 text-left text-[9px] uppercase tracking-[0.15em] font-bold text-muted-foreground w-1/3">Key</th>
              <th className="px-3 py-1.5 text-left text-[9px] uppercase tracking-[0.15em] font-bold text-muted-foreground">Value</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr key={i} className="border-b border-border/40 hover:bg-foreground/[0.02]">
                <td className="px-3 py-1.5 text-foreground/80 font-medium break-all">{e.key}</td>
                <td className="px-3 py-1.5 text-foreground/60 break-all">{e.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Log Viewer with search/grep ─────────────────── */

function LogViewer({ content, isLoading, streaming, streamProps, grep, onGrepChange }: {
  content?: string;
  isLoading: boolean;
  streaming?: boolean;
  streamProps?: { logs: string[]; isConnected: boolean; clear: () => void };
  grep?: string;
  onGrepChange?: (value: string) => void;
}) {
  const [internalGrep, setInternalGrep] = useState("");
  const grepFilter = grep ?? internalGrep;
  const setGrepFilter = onGrepChange ?? setInternalGrep;
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    if (streaming && streamProps) return streamProps.logs;
    if (!content) return [];
    return content.split("\n");
  }, [content, streaming, streamProps]);

  const filteredLines = useMemo(() => {
    if (!grepFilter) return lines.map((l, i) => ({ line: l, num: i + 1 }));
    const lower = grepFilter.toLowerCase();
    return lines
      .map((l, i) => ({ line: l, num: i + 1 }))
      .filter(({ line }) => line.toLowerCase().includes(lower));
  }, [lines, grepFilter]);

  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filteredLines, follow]);

  const isConnected = streaming && streamProps?.isConnected;

  const highlightMatch = useCallback((text: string) => {
    if (!grepFilter) return text;
    const idx = text.toLowerCase().indexOf(grepFilter.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-foreground/20 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + grepFilter.length)}</mark>
        {text.slice(idx + grepFilter.length)}
      </>
    );
  }, [grepFilter]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-foreground/[0.02] border-b border-border rounded-t shrink-0">
        {streaming && (
          <div className="flex items-center gap-1.5">
            {isConnected
              ? <><Wifi className="w-3 h-3 text-foreground/50" /><span className="text-[9px] uppercase tracking-wider font-bold text-foreground/50">streaming</span></>
              : <><WifiOff className="w-3 h-3 text-muted-foreground" /><span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">disconnected</span></>}
            <div className="w-px h-3 bg-border mx-1" />
          </div>
        )}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input value={grepFilter} onChange={e => setGrepFilter(e.target.value)} placeholder="grep filter..."
            className="w-full h-6 pl-7 pr-3 bg-card border border-border rounded text-[10px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/20 transition-all" />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground tabular-nums">
            {grepFilter ? `${filteredLines.length}/${lines.length}` : `${lines.length}`} lines
          </span>
          {streaming && (
            <>
              <button onClick={() => setFollow(!follow)} className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider border transition-colors ${follow ? 'bg-foreground/8 text-foreground border-foreground/15' : 'bg-foreground/[0.03] text-muted-foreground border-border'}`}>
                {follow ? "Follow ●" : "Follow ○"}
              </button>
              <button onClick={streamProps?.clear} className="px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider bg-foreground/[0.03] text-muted-foreground border border-border hover:text-foreground transition-colors">Clear</button>
            </>
          )}
          {lines.length > 0 && <CopyButton text={filteredLines.map(l => l.line).join("\n")} />}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-4 bg-surface-inset rounded-b border border-t-0 border-border font-mono text-[11px] leading-relaxed"
        onScroll={() => { if (!scrollRef.current) return; const { scrollTop, scrollHeight, clientHeight } = scrollRef.current; if (scrollHeight - scrollTop - clientHeight > 100) setFollow(false); }}
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Terminal className="w-3.5 h-3.5" /><span className="animate-pulse">Loading logs...</span></div>
        ) : filteredLines.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Terminal className="w-3.5 h-3.5" /><span>{grepFilter ? "No matching lines" : "No log output"}</span></div>
        ) : filteredLines.map(({ line, num }) => (
          <div key={num} className={`hover:bg-foreground/[0.02] ${line.startsWith("[stderr]") ? "text-destructive/70" : "text-foreground/60"}`}>
            <span className="text-muted-foreground/40 select-none mr-3 inline-block w-10 text-right tabular-nums">{num}</span>
            {highlightMatch(line)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Streaming Logs wrapper ──────────────────────── */

function StreamingLogsPane({ name, context, namespace, grep, onGrepChange }: { name: string; context: string; namespace: string; grep?: string; onGrepChange?: (v: string) => void }) {
  const { logs, isConnected, clear } = useStreamingLogs(name, context, namespace, true);
  return <LogViewer content="" isLoading={false} streaming streamProps={{ logs, isConnected, clear }} grep={grep} onGrepChange={onGrepChange} />;
}

/* ── Deployment Logs (aggregate) ─────────────────── */

function DeploymentLogsPane({ name, context, namespace, grep, onGrepChange }: { name: string; context: string; namespace: string; grep?: string; onGrepChange?: (v: string) => void }) {
  const { data, isLoading } = useDeploymentLogs(name, context, namespace, true);
  return <LogViewer content={data?.logs} isLoading={isLoading} grep={grep} onGrepChange={onGrepChange} />;
}

/* ── Related Resources Panel ─────────────────────── */

function RelatedPanel({ type, name, context, namespace, onNavigate }: {
  type: string; name: string; context: string; namespace: string;
  onNavigate: (type: string, name: string, ns: string) => void;
}) {
  const { data: related, isLoading } = useResourceRelated(type, name, context, namespace);

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-[11px] animate-pulse">Resolving connections...</div>;
  }

  const sections = [
    { key: "services", icon: Network, label: "SERVICES", items: related?.services || [], linkType: "service" },
    { key: "deployments", icon: Layers, label: "DEPLOYMENTS", items: related?.deployments || [], linkType: "deployment" },
    { key: "pods", icon: Box, label: "PODS", items: related?.pods || [], linkType: "pod" },
  ].filter(s => s.items.length > 0);

  if (sections.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <GitBranch className="w-8 h-8 text-muted-foreground/60" />
        <p className="font-mono text-[11px]">No related resources found</p>
        <p className="text-[10px] text-muted-foreground/60">This resource has no label-based connections.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-6">
      {/* Connection Map */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider bg-foreground/5 text-foreground/80 border-border">
          {TYPE_META[type]?.label || type} / {name}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground/60">
          <div className="w-8 h-[1px] bg-gradient-to-r from-white/10 to-white/5" />
          <GitBranch className="w-3 h-3" />
          <div className="w-8 h-[1px] bg-gradient-to-r from-white/5 to-white/10" />
        </div>
        <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
          {sections.reduce((n, s) => n + s.items.length, 0)} connected
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key}>
          <div className="flex items-center gap-2 mb-3">
            <section.icon className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{section.label}</h3>
            <span className="text-[9px] text-muted-foreground/60 tabular-nums">({section.items.length})</span>
          </div>
          <div className="grid gap-2">
            {section.items.map((item: any) => (
              <motion.button
                key={item.name}
                onClick={() => onNavigate(section.linkType, item.name, item.namespace)}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="group text-left w-full p-3 rounded border border-border bg-foreground/[0.02] hover:border-foreground/15 hover:bg-foreground/[0.03] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-foreground/30" />
                    <span className="text-[11px] font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                      {item.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">{item.namespace}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.status && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                        ["Running", "Active"].includes(item.status)
                          ? "bg-foreground/5 text-foreground/60 border-border"
                          : item.status.includes("Error") || item.status.includes("Crash")
                            ? "bg-destructive/10 text-destructive border-destructive/20"
                            : "bg-foreground/5 text-muted-foreground border-border"
                      }`}>{item.status}</span>
                    )}
                    {item.ready && (
                      <span className="text-[9px] font-bold text-muted-foreground bg-foreground/[0.04] px-1.5 py-0.5 rounded-sm border border-border">
                        {item.ready}
                      </span>
                    )}
                    {item.type && (
                      <span className="text-[9px] font-bold text-muted-foreground uppercase">{item.type}</span>
                    )}
                    {item.ports && (
                      <span className="text-[9px] text-muted-foreground tabular-nums">{item.ports}</span>
                    )}
                    {item.restarts !== undefined && item.restarts > 0 && (
                      <span className="text-[9px] text-muted-foreground tabular-nums">{item.restarts} restarts</span>
                    )}
                    <ExternalLink className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Port Forward Bar ────────────────────────────── */

function PortForwardBar() {
  const { data: forwards } = usePortForwards();
  const stopMutation = useStopPortForward();
  const { toast } = useToast();

  if (!forwards || forwards.length === 0) return null;

  const handleStop = async (id: string, pod: string) => {
    try {
      await stopMutation.mutateAsync(id);
      toast({ title: "Stopped", description: `Port forward to ${pod} stopped.` });
    } catch {
      toast({ title: "Error", description: "Failed to stop port forward", variant: "destructive" });
    }
  };

  return (
    <div className="border-t border-border bg-surface/90 px-4 py-1.5 flex items-center gap-3 overflow-x-auto">
      <Share2 className="w-3 h-3 text-foreground/50 shrink-0" />
      <span className="text-[9px] uppercase tracking-wider font-bold text-foreground/50 shrink-0">FORWARDS</span>
      <div className="w-px h-4 bg-foreground/5" />
      {forwards.map((fwd) => {
        const isDead = fwd.status === "dead" || fwd.status === "error";
        return (
          <div key={fwd.id} className={`flex items-center gap-2 px-2 py-0.5 rounded-sm shrink-0 border ${isDead ? 'bg-destructive/5 border-destructive/15' : 'bg-foreground/5 border-border'}`}
            title={isDead ? `Error: ${fwd.error || "Process died"}` : `Active — ${fwd.connections || 0} connections handled`}>
            <div className="relative">
              {isDead ? (
                <div className="w-1.5 h-1.5 rounded-full bg-destructive/60" />
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-foreground/40" />
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-foreground/40 animate-ping opacity-40" />
                </>
              )}
            </div>
            <a href={`http://localhost:${fwd.localPort}`} target="_blank" rel="noopener noreferrer"
              className={`text-[10px] font-mono hover:underline ${isDead ? 'text-destructive/80' : 'text-foreground/70'}`}>
              :{fwd.localPort}
            </a>
            <span className="text-[9px] text-muted-foreground">{"\u2192"}</span>
            <span className="text-[10px] font-mono text-muted-foreground">{fwd.pod}:{fwd.remotePort}</span>
            {isDead && <span className="text-[8px] text-destructive/70 uppercase font-bold">DEAD</span>}
            <button onClick={() => handleStop(fwd.id, fwd.pod)}
              className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors" title="Stop">
              <Square className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Detail Page ────────────────────────────── */

export default function ResourceDetail() {
  const params = useParams<{ type: string; name: string }>();
  const searchString = useSearch();
  const [, navigate] = useLocation();

  const type = params.type || "pod";
  const name = decodeURIComponent(params.name || "");
  const sp = new URLSearchParams(searchString);
  const context = sp.get("context") || "";
  const namespace = sp.get("namespace") || "e2";

  const meta = TYPE_META[type] || TYPE_META.pod;
  const isPod = type === "pod";
  const isDeployment = type === "deployment";

  const { get: getParam, set: setParam } = useHashParams();
  const activeTab = getParam("tab") || "describe";
  const setActiveTab = useCallback((tab: string) => setParam("tab", tab === "describe" ? null : tab), [setParam]);
  const grepFilter = getParam("grep") || "";
  const setGrepFilter = useCallback((g: string) => setParam("grep", g || null), [setParam]);

  const [editing, setEditing] = useState(false);
  const [editYaml, setEditYaml] = useState("");
  const { toast } = useToast();
  const applyMutation = useApplyYaml();

  const goToResource = (rType: string, rName: string, rNs: string) => {
    navigate(`/resource/${rType}/${encodeURIComponent(rName)}?context=${encodeURIComponent(context)}&namespace=${encodeURIComponent(rNs)}`);
  };

  // Data hooks
  const { data: describeData, isLoading: describeLoading, isError: describeError, error: describeErrorObj } = useResourceDescribe(type, name, context, namespace, activeTab === "describe");
  const { data: yamlData, isLoading: yamlLoading, refetch: refetchYaml } = useResourceYaml(type, name, context, namespace, activeTab === "yaml" || activeTab === "edit");
  const { data: eventsData, isLoading: eventsLoading } = useResourceEvents(type, name, context, namespace, activeTab === "events");
  const { data: envData, isLoading: envLoading } = usePodEnv(name, context, namespace, isPod && activeTab === "env");

  // When yaml data loads for edit
  useEffect(() => {
    if (yamlData?.content && activeTab === "edit" && !editing) {
      setEditYaml(yamlData.content);
      setEditing(true);
    }
  }, [yamlData, activeTab, editing]);

  const handleApply = async () => {
    try {
      const result = await applyMutation.mutateAsync({ yaml: editYaml, context });
      toast({ title: "Applied", description: result.message });
      setEditing(false);
      setActiveTab("yaml");
      refetchYaml();
    } catch (e: any) {
      toast({ title: "Apply Failed", description: e.message || "Failed to apply", variant: "destructive" });
    }
  };

  const tabs = [
    { id: "describe", label: "DESCRIBE", icon: FileText },
    { id: "yaml", label: "YAML", icon: Code },
    { id: "edit", label: "EDIT", icon: Pencil },
    ...(isPod ? [
      { id: "logs", label: "LOGS", icon: Terminal },
      { id: "env", label: "ENV", icon: Variable },
    ] : []),
    ...(isDeployment ? [
      { id: "logs", label: "LOGS", icon: Terminal },
    ] : []),
    { id: "events", label: "EVENTS", icon: ScrollText },
    { id: "related", label: "CONNECTED", icon: GitBranch },
  ];

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden font-mono text-foreground selection:bg-primary/30">
      <AppHeader
        showSelectors={false}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: context },
          { label: namespace },
          { label: meta.label },
          { label: name },
        ]}
      />

      {/* ══════ CONTENT ══════ */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-5 pt-4 pb-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-card/50 border border-border p-0.5 h-8 rounded-lg gap-0.5">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="text-[10px] font-bold uppercase tracking-[0.15em] rounded-md px-4 h-7 transition-all gap-1.5
                    data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground
                    data-[state=active]:bg-foreground/8 data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-hidden p-5 pt-3">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="h-full">
              {activeTab === "describe" && (
                <TerminalPane content={describeData?.content} isLoading={describeLoading}
                  emptyMsg={describeError ? (describeErrorObj?.message || "Failed to describe") : "No data"} />
              )}
              {activeTab === "yaml" && (
                <YamlViewer content={yamlData?.content} isLoading={yamlLoading} />
              )}
              {activeTab === "logs" && isPod && (
                <StreamingLogsPane name={name} context={context} namespace={namespace} grep={grepFilter} onGrepChange={setGrepFilter} />
              )}
              {activeTab === "logs" && isDeployment && (
                <DeploymentLogsPane name={name} context={context} namespace={namespace} grep={grepFilter} onGrepChange={setGrepFilter} />
              )}
              {activeTab === "env" && isPod && (
                <EnvViewer content={envData?.env} isLoading={envLoading} />
              )}
              {activeTab === "edit" && (
                <div className="h-full flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <Pencil className="w-3 h-3" />
                      <span className="font-bold uppercase tracking-wider">Edit & Apply</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="text-[10px] uppercase font-bold tracking-wider h-7 px-3 text-muted-foreground hover:text-foreground"
                        onClick={() => { setEditing(false); setActiveTab("yaml"); }}
                      >Cancel</Button>
                      <Button
                        className="bg-foreground/10 hover:bg-foreground/15 text-foreground text-[10px] uppercase font-bold tracking-wider h-7 px-4 rounded-md gap-1.5 border border-border"
                        onClick={handleApply}
                        disabled={applyMutation.isPending}
                      >
                        <Save className="w-3 h-3" />
                        {applyMutation.isPending ? "Applying..." : "Apply"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden rounded border border-border bg-surface-inset">
                    <textarea
                      value={editYaml}
                      onChange={(e) => setEditYaml(e.target.value)}
                      className="w-full h-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed text-foreground/70 focus:outline-none"
                      spellCheck={false}
                      placeholder={yamlLoading ? "Loading YAML..." : "Paste or edit YAML here..."}
                    />
                  </div>
                </div>
              )}
              {activeTab === "events" && (
                <TerminalPane content={eventsData?.content} isLoading={eventsLoading} emptyMsg="No events found" />
              )}
              {activeTab === "related" && (
                <RelatedPanel type={type} name={name} context={context} namespace={namespace} onNavigate={goToResource} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ══════ PORT FORWARD STATUS BAR ══════ */}
      <PortForwardBar />

      <CommandBar command={buildDescribeCommand(type, name, context, namespace)} />
    </div>
  );
}
