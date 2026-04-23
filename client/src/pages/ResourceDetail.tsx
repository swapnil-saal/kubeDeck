import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import {
  useResourceDescribe, useResourceYaml, useResourceEvents,
  usePodLogs, usePodEnv, useStreamingLogs, useResourceRelated,
  usePortForward, usePortForwards, useStopPortForward, useApplyYaml,
} from "@/hooks/use-k8s";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, Code, ScrollText,
  Terminal, Variable, Wifi, WifiOff, Copy, Check, GitBranch,
  Box, Layers, Network, Share2, Square, ExternalLink, Save, Pencil,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { CommandBar, buildDescribeCommand } from "@/components/CommandBar";

const TYPE_META: Record<string, { label: string; color: string; bgActive: string }> = {
  pod:            { label: "POD",          color: "cyan",    bgActive: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
  deployment:     { label: "DEPLOYMENT",   color: "violet",  bgActive: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  service:        { label: "SERVICE",      color: "emerald", bgActive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  configmap:      { label: "CONFIGMAP",    color: "cyan",    bgActive: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
  secret:         { label: "SECRET",       color: "violet",  bgActive: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  ingress:        { label: "INGRESS",      color: "pink",    bgActive: "bg-pink-500/15 text-pink-700 dark:text-pink-400" },
  statefulset:    { label: "STATEFULSET",  color: "cyan",    bgActive: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400" },
  daemonset:      { label: "DAEMONSET",    color: "violet",  bgActive: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  job:            { label: "JOB",          color: "amber",   bgActive: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  cronjob:        { label: "CRONJOB",      color: "violet",  bgActive: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
  node:           { label: "NODE",         color: "amber",   bgActive: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  hpa:            { label: "HPA",          color: "emerald", bgActive: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  pvc:            { label: "PVC",          color: "violet",  bgActive: "bg-violet-500/15 text-violet-700 dark:text-violet-400" },
};

/* ── Helpers ─────────────────────────────────────── */

const terminalColorClasses: Record<string, string> = {
  slate:   "text-slate-700 dark:text-slate-300",
  cyan:    "text-cyan-700 dark:text-cyan-400",
  amber:   "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  violet:  "text-violet-700 dark:text-violet-400",
  red:     "text-red-700 dark:text-red-400",
  pink:    "text-pink-700 dark:text-pink-400",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-foreground/5 text-muted-foreground hover:text-muted-foreground transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function TerminalPane({ content, isLoading, color = "cyan", emptyMsg = "No data" }: {
  content?: string; isLoading: boolean; color?: string; emptyMsg?: string;
}) {
  return (
    <div className="relative h-full">
      {content && <div className="absolute top-2 right-2 z-10"><CopyButton text={content} /></div>}
      <div className="h-full overflow-auto p-4 bg-surface-inset rounded border border-border">
        {isLoading ? (
          <div className="flex items-center gap-2 text-cyan-500/50 font-mono text-[12px]">
            <span className="inline-block w-2 h-4 bg-cyan-500/50 animate-pulse" />
            <span className="animate-pulse">executing...</span>
          </div>
        ) : content ? (
          <pre className={`whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${terminalColorClasses[color] ?? "text-foreground/80"}`}>{content}</pre>
        ) : (
          <p className="text-[11px] text-muted-foreground font-mono">{emptyMsg}</p>
        )}
      </div>
    </div>
  );
}

function StreamingLogsPane({ name, context, namespace }: { name: string; context: string; namespace: string }) {
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { logs, isConnected, clear } = useStreamingLogs(name, context, namespace, true);

  useEffect(() => {
    if (follow && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, follow]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-foreground/[0.02] border-b border-border rounded-t">
        <div className="flex items-center gap-1.5">
          {isConnected
            ? <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400">streaming</span></>
            : <><WifiOff className="w-3 h-3 text-muted-foreground" /><span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">disconnected</span></>}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground tabular-nums">{logs.length} lines</span>
          <button onClick={() => setFollow(!follow)} className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider border transition-colors ${follow ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'bg-foreground/[0.03] text-muted-foreground border-border'}`}>
            {follow ? "Follow \u25CF" : "Follow \u25CB"}
          </button>
          <button onClick={clear} className="px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider bg-foreground/[0.03] text-muted-foreground border border-border hover:text-muted-foreground transition-colors">Clear</button>
          {logs.length > 0 && <CopyButton text={logs.join("\n")} />}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-4 bg-surface-inset rounded-b border border-t-0 border-border font-mono text-[11px] leading-relaxed"
        onScroll={() => { if (!scrollRef.current) return; const { scrollTop, scrollHeight, clientHeight } = scrollRef.current; if (scrollHeight - scrollTop - clientHeight > 100) setFollow(false); }}
      >
        {logs.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground"><Terminal className="w-3.5 h-3.5" /><span>Waiting for log output...</span></div>
        ) : logs.map((line, i) => (
          <div key={i} className={`hover:bg-foreground/[0.02] ${line.startsWith("[stderr]") ? "text-red-600 dark:text-red-400/70" : "text-cyan-700 dark:text-cyan-500/70"}`}>
            <span className="text-muted-foreground/60 select-none mr-3 inline-block w-10 text-right tabular-nums">{i + 1}</span>{line}
          </div>
        ))}
      </div>
    </div>
  );
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
    { key: "services", icon: Network, label: "SERVICES", color: "emerald", items: related?.services || [], linkType: "service" },
    { key: "deployments", icon: Layers, label: "DEPLOYMENTS", color: "violet", items: related?.deployments || [], linkType: "deployment" },
    { key: "pods", icon: Box, label: "PODS", color: "cyan", items: related?.pods || [], linkType: "pod" },
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
        <div className={`px-3 py-1.5 rounded border text-[10px] font-bold uppercase tracking-wider bg-${TYPE_META[type]?.color || "cyan"}-500/10 text-${TYPE_META[type]?.color || "cyan"}-400 border-${TYPE_META[type]?.color || "cyan"}-500/20`}>
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
            <section.icon className={`w-3.5 h-3.5 text-${section.color}-400`} />
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
                className={`group text-left w-full p-3 rounded border border-border bg-foreground/[0.02] hover:border-${section.color}-500/20 hover:bg-${section.color}-500/[0.02] transition-all`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full bg-${section.color}-400`} />
                    <span className={`text-[11px] font-medium text-${section.color}-400 group-hover:text-${section.color}-300 transition-colors`}>
                      {item.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">{item.namespace}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.status && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm border ${
                        ["Running", "Active"].includes(item.status)
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : item.status.includes("Error") || item.status.includes("Crash")
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
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
                      <span className="text-[9px] text-cyan-500/70 tabular-nums">{item.ports}</span>
                    )}
                    {item.restarts !== undefined && item.restarts > 0 && (
                      <span className="text-[9px] text-amber-400 tabular-nums">{item.restarts} restarts</span>
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
      <Share2 className="w-3 h-3 text-emerald-400 shrink-0" />
      <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400/80 shrink-0">FORWARDS</span>
      <div className="w-px h-4 bg-foreground/5" />
      {forwards.map((fwd) => {
        const isDead = fwd.status === "dead" || fwd.status === "error";
        return (
          <div key={fwd.id} className={`flex items-center gap-2 px-2 py-0.5 rounded-sm shrink-0 border ${isDead ? 'bg-red-500/5 border-red-500/15' : 'bg-emerald-500/5 border-emerald-500/15'}`}
            title={isDead ? `Error: ${fwd.error || "Process died"}` : `Active — ${fwd.connections || 0} connections handled`}>
            <div className="relative">
              {isDead ? (
                <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
              ) : (
                <>
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-50" />
                </>
              )}
            </div>
            <a href={`http://localhost:${fwd.localPort}`} target="_blank" rel="noopener noreferrer"
              className={`text-[10px] font-mono hover:underline ${isDead ? 'text-red-400/90' : 'text-emerald-400/90'}`}>
              :{fwd.localPort}
            </a>
            <span className="text-[9px] text-muted-foreground">{"\u2192"}</span>
            <span className="text-[10px] font-mono text-muted-foreground">{fwd.pod}:{fwd.remotePort}</span>
            {isDead && <span className="text-[8px] text-red-400/70 uppercase font-bold">DEAD</span>}
            <button onClick={() => handleStop(fwd.id, fwd.pod)}
              className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors" title="Stop">
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

  const [activeTab, setActiveTab] = useState("describe");
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
            <TabsList className="bg-transparent border border-border p-0.5 h-8 rounded gap-0.5">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={`text-[10px] font-bold uppercase tracking-[0.15em] rounded-sm px-4 h-7 transition-all gap-1.5
                    data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground
                    data-[state=active]:${meta.bgActive} data-[state=active]:shadow-none`}
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
                <TerminalPane content={describeData?.content} isLoading={describeLoading} color="slate"
                  emptyMsg={describeError ? (describeErrorObj?.message || "Failed to describe") : "No data"} />
              )}
              {activeTab === "yaml" && (
                <TerminalPane content={yamlData?.content} isLoading={yamlLoading} color="amber" emptyMsg="No YAML data" />
              )}
              {activeTab === "logs" && isPod && (
                <StreamingLogsPane name={name} context={context} namespace={namespace} />
              )}
              {activeTab === "env" && isPod && (
                <TerminalPane content={envData?.env} isLoading={envLoading} color="emerald" emptyMsg="No environment data (pod may not be running)" />
              )}
              {activeTab === "edit" && (
                <div className="h-full flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                      <Pencil className="w-3 h-3 text-amber-400" />
                      <span className="text-amber-400 font-bold uppercase tracking-wider">Edit & Apply</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Button
                        variant="ghost"
                        className="text-[10px] uppercase font-bold tracking-wider h-7 px-3 text-muted-foreground hover:text-foreground"
                        onClick={() => { setEditing(false); setActiveTab("yaml"); }}
                      >Cancel</Button>
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] uppercase font-bold tracking-wider h-7 px-4 rounded-sm gap-1.5"
                        onClick={handleApply}
                        disabled={applyMutation.isPending}
                      >
                        <Save className="w-3 h-3" />
                        {applyMutation.isPending ? "Applying..." : "Apply"}
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden rounded border border-amber-500/20 bg-surface-inset">
                    <textarea
                      value={editYaml}
                      onChange={(e) => setEditYaml(e.target.value)}
                      className="w-full h-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed text-amber-500/80 focus:outline-none"
                      spellCheck={false}
                      placeholder={yamlLoading ? "Loading YAML..." : "Paste or edit YAML here..."}
                    />
                  </div>
                </div>
              )}
              {activeTab === "events" && (
                <TerminalPane content={eventsData?.content} isLoading={eventsLoading} color="violet" emptyMsg="No events found" />
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
