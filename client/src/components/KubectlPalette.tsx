import { useServerMode } from "@/hooks/use-server-mode";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ArrowRight, Check, Copy, Loader2, Search, Sparkles, Terminal } from "lucide-react";
import { ConfirmPanel } from "@/components/palette/ConfirmPanel";
import { EditableCommand, INTERACTIVE_COMMANDS } from "@/components/palette/EditableCommand";
import { EmptyState } from "@/components/palette/EmptyState";
import { ExecOutput, type ExecResult } from "@/components/palette/ExecOutput";
import { buildCtx, buildNs, matchQuery, type MatchedCommand } from "@/components/palette/patterns";
import { ScopeStrip } from "@/components/palette/ScopeStrip";
import { navigateHash as hashNavigate } from "@/lib/hash-router";
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useAiConfig, translateToKubectl } from "@/ai";
import { useResourceNames, searchResourceNames } from "@/hooks/use-resource-names";
import { useSmartSuggestions } from "@/hooks/use-smart-suggestions";
import {
  getKubectlHistory, recordKubectlHistory, clearKubectlHistory,
} from "@/lib/kubectl-history";
import { useK8sNamespaces, useK8sPods, useK8sDeployments, useK8sServices } from "@/hooks/use-k8s";

export function KubectlPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [execState, setExecState] = useState<{ idx: number; loading: boolean; result: ExecResult | null; error: string | null } | null>(null);
  const [editedCmds, setEditedCmds] = useState<Record<number, string>>({});
  const [aiTranslating, setAiTranslating] = useState(false);
  const [aiTranslated, setAiTranslated] = useState<MatchedCommand | null>(null);
  const [aiEditedCmd, setAiEditedCmd] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const { context, namespace, setNamespace } = useTerminalStore();
  const { isConfigured: aiConfigured } = useAiConfig();
  const { aiEnabled } = useServerMode();
  const isConfigured = aiConfigured && aiEnabled;
  const resourceNames = useResourceNames();
  const smartSuggestions = useSmartSuggestions(context, namespace);
  const { data: namespaces } = useK8sNamespaces(context);
  // Warm the cache so resource-name autocomplete + AI translation have data
  // even if the user opens the palette without visiting the dashboard first.
  // These hooks dedupe with the dashboard's identical queries, so there's no
  // extra cost when they overlap.
  useK8sPods(context, namespace);
  useK8sDeployments(context, namespace);
  useK8sServices(context, namespace);
  // The palette lives outside Route tree; use shared hash navigate so query
  // stays in the hash (and is cleared when leaving the page).
  const navigateHash = useCallback((to: string) => {
    hashNavigate(to);
  }, []);
  const [history, setHistory] = useState(() => getKubectlHistory(context, namespace));
  const [selectedIdx, setSelectedIdx] = useState(0);

  // names the palette knows, so a request's words resolve to real resources (never "kubectl logs the")
  const results = useMemo(
    () => matchQuery(query, context, namespace, (type) => resourceNames.filter((r) => r.type === type).map((r) => r.name)),
    [query, context, namespace, resourceNames],
  );

  const ctxFlag = useMemo(() => buildCtx(context), [context]);
  const nsFlag = useMemo(() => buildNs(namespace), [namespace]);

  const nameResults = useMemo(
    () => searchResourceNames(query, resourceNames, ctxFlag, nsFlag),
    [query, resourceNames, ctxFlag, nsFlag],
  );

  const isNaturalLanguage = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.startsWith("kubectl")) return false;
    if (trimmed.length < 5) return false;
    const kubectlVerbs = /^(get|describe|logs|exec|apply|delete|scale|rollout|top|cordon|drain|edit|patch|create|replace|annotate|label)\b/i;
    return !kubectlVerbs.test(trimmed);
  }, [query]);

  const doAiTranslate = useCallback(async (q: string) => {
    setAiTranslating(true);
    setAiTranslated(null);
    setAiEditedCmd(null);
    try {
      // Build a per-kind resource catalog from the React Query cache so the
      // translator can resolve fuzzy names ("course" → "e2-course-…").
      const byKind: Record<string, string[]> = {};
      for (const r of resourceNames) {
        const k = r.type;
        if (!byKind[k]) byKind[k] = [];
        // Avoid pushing the same name multiple times (the cache can yield dups
        // when results come from different namespaces).
        if (!byKind[k].includes(r.name)) byKind[k].push(r.name);
      }

      const { command, explanation, risk } = await translateToKubectl({
        prompt: q,
        context: context || undefined,
        namespace: namespace && namespace !== "all" ? namespace : undefined,
        resources: byKind,
      });
      if (command) {
        const description = risk === "blocked"
          ? `KubeDeck won't run this (destructive): ${explanation || q}`
          : risk === "write" ? `Changes the cluster: ${explanation || q}` : explanation || q;
        setAiTranslated({ description, command, confidence: 0.95 });
      }
    } catch { /* translation is optional; the typed text still works as a search */ }
    setAiTranslating(false);
  }, [context, namespace, resourceNames]);

  // Auto-translate when no patterns and no name matches and it's natural language
  useEffect(() => {
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    if (!isConfigured || !isNaturalLanguage || results.length > 0 || nameResults.length > 0 || !query.trim()) {
      return;
    }
    aiDebounceRef.current = setTimeout(() => {
      doAiTranslate(query);
    }, 600);
    return () => { if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current); };
  }, [query, isConfigured, isNaturalLanguage, results.length, nameResults.length, doAiTranslate]);

  const aiCmd = aiEditedCmd ?? aiTranslated?.command ?? "";
  const aiPending = isConfigured && isNaturalLanguage && results.length === 0 && nameResults.length === 0 && query.trim().length >= 5 && !aiTranslated;
  const getCmd = useCallback((idx: number) => editedCmds[idx] ?? results[idx]?.command ?? "", [editedCmds, results]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCopiedIdx(null);
      setExecState(null);
      setEditedCmds({});
      setAiTranslated(null);
      setAiEditedCmd(null);
      setAiTranslating(false);
      setConfirmState(null);
      setHistory(getKubectlHistory(context, namespace));
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, context, namespace]);

  useEffect(() => {
    setEditedCmds({});
    setAiTranslated(null);
    setAiEditedCmd(null);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (execState) { setExecState(null); } else { onClose(); }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, execState]);

  // ── Keyboard nav for the results list ────────────
  // We compose a virtual "navigable list": [smart suggestions if empty query]
  // OR [aiTranslated + nameResults + results] when query has text.
  const navigableCmds = useMemo<string[]>(() => {
    if (!query.trim()) {
      return smartSuggestions.map((s) => s.command);
    }
    const list: string[] = [];
    if (aiTranslated) list.push(aiCmd);
    for (const nr of nameResults) list.push(nr.command);
    for (const r of results) list.push(r.command);
    return list;
  }, [query, smartSuggestions, aiTranslated, aiCmd, nameResults, results]);

  // Reset selection when the underlying list changes
  useEffect(() => {
    setSelectedIdx((i) => (i >= navigableCmds.length ? 0 : i));
  }, [navigableCmds.length]);

  // Indirect `handleExec` through a ref so this effect can be defined before
  // `handleExec` without tripping the TDZ.
  const execRef = useRef<((cmd: string, idx: number) => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        if (navigableCmds.length === 0) return;
        e.preventDefault();
        setSelectedIdx((i) => Math.min(navigableCmds.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        if (navigableCmds.length === 0) return;
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd+Enter runs the selected command from anywhere
        e.preventDefault();
        const cmd = navigableCmds[selectedIdx];
        if (cmd) execRef.current?.(cmd, -3);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, navigableCmds, selectedIdx]);

  useEffect(() => {
    if (execState?.result && outputRef.current) {
      outputRef.current.scrollTop = 0;
    }
  }, [execState?.result]);

  const handleCopy = useCallback((cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }, []);

  const handleCopyOutput = useCallback(() => {
    if (!execState?.result) return;
    const text = execState.result.stdout || execState.result.stderr;
    navigator.clipboard.writeText(text);
  }, [execState]);

  const [confirmState, setConfirmState] = useState<{ idx: number; command: string; warning: string } | null>(null);

  const handleExec = useCallback(async (cmd: string, idx: number, confirmed = false) => {
    setConfirmState(null);
    setExecState({ idx, loading: true, result: null, error: null });
    try {
      const res = await fetch("/api/kubectl/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, confirmed }),
      });
      const data = await res.json();
      if (data.blocked) {
        setExecState({ idx, loading: false, result: null, error: `Blocked: ${data.message}` });
      } else if (data.needsConfirmation) {
        setExecState(null);
        setConfirmState({ idx, command: data.command, warning: data.warning });
      } else if (!res.ok) {
        setExecState({ idx, loading: false, result: null, error: data.message || "Execution failed" });
      } else {
        setExecState({ idx, loading: false, result: data, error: null });
        // Record the successful execution in history (scoped to ctx+ns)
        recordKubectlHistory(cmd, context, namespace);
        setHistory(getKubectlHistory(context, namespace));
      }
    } catch (err: any) {
      setExecState({ idx, loading: false, result: null, error: err.message || "Network error" });
    }
  }, [context, namespace]);

  // Bind the ref so the keyboard-nav effect (declared earlier) can call this
  // without a TDZ violation.
  useEffect(() => {
    execRef.current = handleExec;
  }, [handleExec]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]" onClick={() => { if (!execState) onClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-card/95 backdrop-blur border border-border/50 rounded-xl shadow-xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 h-12 border-b border-border/50">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setExecState(null); setSelectedIdx(0); }}
            placeholder="Describe what you want, paste kubectl, or search resources… (e.g. 'logs for e2-course')"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <kbd className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded-lg border border-border/50 text-[10px] text-muted-foreground/50 font-semibold">ESC</kbd>
        </div>

        {/* Scope strip — shows active ctx/ns + inline namespace switcher */}
        <ScopeStrip
          context={context}
          namespace={namespace}
          namespaces={namespaces?.map((n) => n.name) || []}
          onNamespaceChange={setNamespace}
          onAskAi={!aiEnabled ? undefined : () => {
            const q = query.trim();
            navigateHash(
              `/ai?prompt=${encodeURIComponent(q || "Help me investigate this cluster")}` +
                `&context=${encodeURIComponent(context)}` +
                `&namespace=${encodeURIComponent(namespace)}`,
            );
            onClose();
          }}
        />

        {/* Results */}
        <div className="max-h-[55vh] overflow-auto">
          {/* Fallback examples — only when nothing matches */}
          {query.trim() && results.length === 0 && nameResults.length === 0 && !aiTranslated && !aiPending && (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-muted-foreground">No matching patterns. Try phrases like:</p>
              <div className="mt-3 space-y-1.5">
                {["show me crashing pods", "scale myapp to 5", "exec into my-pod", "pods with restarts > 3", "top pods by cpu"].map(ex => (
                  <button
                    key={ex}
                    onClick={() => setQuery(ex)}
                    className="block mx-auto text-[10px] text-foreground/60 hover:text-foreground bg-foreground/[0.03] hover:bg-foreground/[0.06] px-3 py-1 rounded-md border border-border transition-colors"
                  >
                    "{ex}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI translating spinner — visible during debounce + fetch */}
          {aiPending && !aiTranslated && (
            <div className="px-4 py-8 flex flex-col items-center gap-3 border-b border-primary/20 bg-primary/[0.02]">
              <div className="relative">
                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                <Loader2 className="w-5 h-5 text-primary/60 animate-spin absolute inset-0" />
              </div>
              <p className="text-[11px] text-primary font-medium">
                {aiTranslating ? "Translating to kubectl..." : "Preparing AI translation..."}
              </p>
              <p className="text-[10px] text-muted-foreground max-w-xs text-center">
                Using your configured model to generate the kubectl command
              </p>
            </div>
          )}

          {/* AI translated result — full interactive card */}
          {aiTranslated && (
            <div>
              <EditableCommand
                tone="ai"
                icon={<Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
                description={<>AI: {aiTranslated.description}</>}
                command={aiCmd}
                edited={aiEditedCmd !== null && aiEditedCmd !== aiTranslated.command}
                onChange={setAiEditedCmd}
                onReset={() => setAiEditedCmd(null)}
                onRun={() => handleExec(aiCmd, -1)}
                onCopy={() => handleCopy(aiCmd, -1)}
                copied={copiedIdx === -1}
                running={execState?.idx === -1 && execState.loading}
              />
              {execState?.idx === -1 && !execState.loading && (execState.result || execState.error) && (
                <ExecOutput result={execState.result} error={execState.error} onCopy={handleCopyOutput} onClose={() => setExecState(null)} outputRef={outputRef} />
              )}
            </div>
          )}

          {/* Manual AI translate button when pattern results exist but query is NL */}
          {isConfigured && isNaturalLanguage && results.length > 0 && !aiTranslated && !aiTranslating && (
            <div className="px-4 py-2 border-b border-border/50 bg-foreground/[0.01]">
              <button
                onClick={() => doAiTranslate(query)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/15 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                AI Translate
              </button>
            </div>
          )}

          {/* Resource name autocomplete results */}
          {nameResults.length > 0 && (
            <>
              {results.length === 0 && !aiTranslated && !aiPending && (
                <div className="px-4 py-1.5 border-b border-border/50 bg-foreground/[0.01]">
                  <p className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wider flex items-center gap-1.5">
                    <Search className="w-3 h-3" />
                    Cluster resources matching your query
                  </p>
                </div>
              )}
              {nameResults.map((nr, ni) => {
                const nIdx = 1000 + ni;
                const isRunning = execState?.idx === nIdx && execState.loading;
                const hasResult = execState?.idx === nIdx && !execState.loading && (execState.result || execState.error);
                const isInteractive = INTERACTIVE_COMMANDS.test(nr.command);
                return (
                  <div key={`nr-${ni}`}>
                    <div className="group flex items-center gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-foreground/[0.03] transition-colors">
                      <Search className="w-3 h-3 text-primary/60 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-foreground/70 capitalize">{nr.description}</p>
                        <p className="text-[9px] text-muted-foreground/50 font-mono truncate">{nr.command}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isInteractive && (
                          <button
                            onClick={() => handleExec(nr.command, nIdx)}
                            disabled={isRunning}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-primary/20 text-[10px] font-medium text-primary bg-primary/5 hover:bg-primary/10 transition-colors disabled:opacity-50"
                          >
                            {isRunning ? (
                              <div className="w-3 h-3 border border-muted-foreground/40 border-t-foreground/60 rounded-full animate-spin" />
                            ) : (
                              <ArrowRight className="w-3 h-3" />
                            )}
                            Run
                          </button>
                        )}
                        <button
                          onClick={() => handleCopy(nr.command, nIdx)}
                          className="p-1.5 rounded hover:bg-foreground/8 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {copiedIdx === nIdx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {hasResult && (
                      <ExecOutput result={execState!.result} error={execState!.error} onCopy={handleCopyOutput} onClose={() => setExecState(null)} outputRef={outputRef} />
                    )}
                  </div>
                );
              })}
            </>
          )}

          {results.map((r, i) => {
            const currentCmd = getCmd(i);
            const hasResult = execState?.idx === i && !execState.loading && (execState.result || execState.error);
            return (
              <div key={i}>
                <EditableCommand
                  icon={<Terminal className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />}
                  description={r.description}
                  command={currentCmd}
                  edited={editedCmds[i] !== undefined && editedCmds[i] !== r.command}
                  onChange={(cmd) => setEditedCmds((prev) => ({ ...prev, [i]: cmd }))}
                  onReset={() => setEditedCmds((prev) => { const copy = { ...prev }; delete copy[i]; return copy; })}
                  onRun={() => handleExec(currentCmd, i)}
                  onCopy={() => handleCopy(currentCmd, i)}
                  copied={copiedIdx === i}
                  running={execState?.idx === i && execState.loading}
                />
                {hasResult && (
                  <ExecOutput result={execState!.result} error={execState!.error} onCopy={handleCopyOutput} onClose={() => setExecState(null)} outputRef={outputRef} />
                )}
              </div>
            );
          })}
        </div>

        {/* Confirmation dialog for mutating commands */}
        {confirmState && (
          <ConfirmPanel
            warning={confirmState.warning}
            command={confirmState.command}
            onConfirm={() => handleExec(confirmState.command, confirmState.idx, true)}
            onCancel={() => setConfirmState(null)}
          />
        )}

        {/* Footer hints */}
        {!query.trim() && !execState && !confirmState && (
          <EmptyState
            smartSuggestions={smartSuggestions}
            history={history}
            onPick={(cmd) => setQuery(cmd)}
            onRun={(cmd) => handleExec(cmd, -2)}
            onClearHistory={() => {
              clearKubectlHistory(context, namespace);
              setHistory([]);
            }}
            context={context}
            namespace={namespace}
          />
        )}
      </div>
    </div>
  );
}
