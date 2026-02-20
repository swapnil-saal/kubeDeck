import { useState, useEffect, useRef } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useResourceDescribe, useResourceYaml, useResourceEvents, usePodLogs, usePodEnv, useStreamingLogs } from "@/hooks/use-k8s";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Monitor, ChevronRight, FileText, Code, ScrollText, Terminal, Variable, AlertTriangle, Wifi, WifiOff, Trash2, Copy, Check } from "lucide-react";
import { motion } from "framer-motion";

const TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
  pod: { label: "POD", color: "cyan", icon: "📦" },
  deployment: { label: "DEPLOYMENT", color: "violet", icon: "🚀" },
  service: { label: "SERVICE", color: "emerald", icon: "🌐" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-white/5 text-slate-600 hover:text-slate-400 transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function TerminalPane({ content, isLoading, color = "cyan", emptyMsg = "No data", copyable = true }: {
  content?: string; isLoading: boolean; color?: string; emptyMsg?: string; copyable?: boolean;
}) {
  return (
    <div className="relative h-full">
      {copyable && content && (
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={content} />
        </div>
      )}
      <div className="h-full overflow-auto p-4 bg-[#04060a] rounded border border-white/[0.03]">
        {isLoading ? (
          <div className="flex items-center gap-2 text-cyan-500/50 font-mono text-[12px]">
            <span className="inline-block w-2 h-4 bg-cyan-500/50 animate-pulse" />
            <span className="animate-pulse">executing...</span>
          </div>
        ) : content ? (
          <pre className={`whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-${color}-500/80`}>
            {content}
          </pre>
        ) : (
          <p className="text-[11px] text-slate-600 font-mono">{emptyMsg}</p>
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
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, follow]);

  return (
    <div className="h-full flex flex-col">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.01] border-b border-white/[0.03] rounded-t">
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-[9px] uppercase tracking-wider font-bold text-emerald-400">streaming</span></>
          ) : (
            <><WifiOff className="w-3 h-3 text-slate-600" /><span className="text-[9px] uppercase tracking-wider font-bold text-slate-600">disconnected</span></>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[9px] text-slate-600 tabular-nums">{logs.length} lines</span>
          <button onClick={() => setFollow(!follow)} className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider border transition-colors ${follow ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'bg-white/[0.02] text-slate-600 border-white/[0.04]'}`}>
            {follow ? "Follow ●" : "Follow ○"}
          </button>
          <button onClick={clear} className="px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold tracking-wider bg-white/[0.02] text-slate-600 border border-white/[0.04] hover:text-slate-400 transition-colors">
            Clear
          </button>
          {logs.length > 0 && <CopyButton text={logs.join("\n")} />}
        </div>
      </div>

      {/* Log output */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-4 bg-[#04060a] rounded-b border border-t-0 border-white/[0.03] font-mono text-[11px] leading-relaxed"
        onScroll={() => {
          if (!scrollRef.current) return;
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          // Auto-disable follow if user scrolls up
          if (scrollHeight - scrollTop - clientHeight > 100) setFollow(false);
        }}
      >
        {logs.length === 0 ? (
          <div className="flex items-center gap-2 text-slate-600">
            <Terminal className="w-3.5 h-3.5" />
            <span>Waiting for log output...</span>
          </div>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`hover:bg-white/[0.01] ${line.startsWith("[stderr]") ? "text-red-400/70" : "text-cyan-500/70"}`}>
              <span className="text-slate-700 select-none mr-3 inline-block w-10 text-right tabular-nums">{i + 1}</span>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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

  // Data hooks
  const { data: describeData, isLoading: describeLoading, isError: describeError, error: describeErrorObj } = useResourceDescribe(type, name, context, namespace, activeTab === "describe");
  const { data: yamlData, isLoading: yamlLoading } = useResourceYaml(type, name, context, namespace, activeTab === "yaml");
  const { data: eventsData, isLoading: eventsLoading } = useResourceEvents(type, name, context, namespace, activeTab === "events");
  const { data: envData, isLoading: envLoading } = usePodEnv(name, context, namespace, isPod && activeTab === "env");

  const tabs = [
    { id: "describe", label: "DESCRIBE", icon: FileText },
    { id: "yaml", label: "YAML", icon: Code },
    ...(isPod ? [
      { id: "logs", label: "LOGS", icon: Terminal },
      { id: "env", label: "ENV", icon: Variable },
    ] : []),
    { id: "events", label: "EVENTS", icon: ScrollText },
  ];

  return (
    <div className="flex flex-col h-screen bg-[#06080c] overflow-hidden font-mono text-slate-300 selection:bg-cyan-500/30">
      {/* ══════ HEADER ══════ */}
      <header className="relative z-10 border-b border-cyan-500/10 bg-[#080a10]/90 backdrop-blur-xl">
        <div className="h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        <div className="flex items-center h-12 px-4 gap-0">
          {/* Back + Logo */}
          <button onClick={() => navigate("/")} className="flex items-center gap-2 pr-4 border-r border-white/5 text-slate-500 hover:text-cyan-400 transition-colors group">
            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-cyan-400" />
              <span className="text-[11px] font-bold tracking-[0.2em] text-cyan-400">KUBEDECK</span>
            </div>
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-0 text-[11px]">
            <ChevronRight className="w-3 h-3 text-white/10 mx-2" />
            <span className="text-slate-600">{context}</span>
            <ChevronRight className="w-3 h-3 text-white/10 mx-2" />
            <span className="text-slate-600">{namespace}</span>
            <ChevronRight className="w-3 h-3 text-white/10 mx-2" />
            <span className={`text-[9px] uppercase tracking-[0.15em] font-bold text-${meta.color}-400 bg-${meta.color}-500/10 px-1.5 py-0.5 rounded-sm`}>
              {meta.label}
            </span>
            <ChevronRight className="w-3 h-3 text-white/10 mx-2" />
            <span className={`text-${meta.color}-400 font-medium`}>{name}</span>
          </div>
        </div>
        <div className="h-[1px] bg-gradient-to-r from-cyan-500/20 via-transparent to-emerald-500/20" />
      </header>

      {/* ══════ CONTENT ══════ */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Tab bar */}
        <div className="px-5 pt-4 pb-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-transparent border border-white/[0.04] p-0.5 h-8 rounded gap-0.5">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className={`text-[10px] font-bold uppercase tracking-[0.15em] rounded-sm px-4 h-7 transition-all gap-1.5 data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:text-slate-400 data-[state=active]:bg-${meta.color}-500/15 data-[state=active]:text-${meta.color}-400 data-[state=active]:shadow-none`}
                >
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden p-5 pt-3">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            {activeTab === "describe" && (
              <TerminalPane
                content={describeData?.content}
                isLoading={describeLoading}
                color="slate"
                emptyMsg={describeError ? (describeErrorObj?.message || "Failed to describe resource") : "No data"}
              />
            )}

            {activeTab === "yaml" && (
              <TerminalPane
                content={yamlData?.content}
                isLoading={yamlLoading}
                color="amber"
                emptyMsg="No YAML data"
              />
            )}

            {activeTab === "logs" && isPod && (
              <StreamingLogsPane name={name} context={context} namespace={namespace} />
            )}

            {activeTab === "env" && isPod && (
              <TerminalPane
                content={envData?.env}
                isLoading={envLoading}
                color="emerald"
                emptyMsg="No environment data (pod may not be running)"
              />
            )}

            {activeTab === "events" && (
              <TerminalPane
                content={eventsData?.content}
                isLoading={eventsLoading}
                color="violet"
                emptyMsg="No events found"
              />
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
