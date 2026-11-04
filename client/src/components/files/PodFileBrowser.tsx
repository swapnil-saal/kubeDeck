import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC, type FormEvent } from "react";
import {
  AlertTriangle, ChevronDown, ChevronRight, Copy, Download, File, FileText, Folder, FolderOpen, Loader2, Search, X,
} from "lucide-react";
import {
  downloadHref, useFile, useFileSearch, useFolder, usePodContainers, type FileSearch, type PodFilesTarget,
} from "@/hooks/use-pod-files";
import { cn } from "@/lib/utils";

const LINE_PX = 20;

const join = (dir: string, name: string) => (dir === "/" ? `/${name}` : `${dir}/${name}`);
const parentOf = (p: string) => (p.lastIndexOf("/") <= 0 ? "/" : p.slice(0, p.lastIndexOf("/")));
const humanSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function Problem({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p className="text-foreground">{message}</p>
      </div>
    </div>
  );
}

// ── tree ──────────────────────────────────────────────────

interface TreeProps {
  target: PodFilesTarget;
  path: string;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

/** One folder's children; sub-folders load when expanded. */
const FolderChildren: FC<TreeProps> = memo(function FolderChildren({ target, path, depth, expanded, selected, onToggle, onOpen }) {
  const folder = useFolder(target, path);
  const pad = { paddingLeft: 8 + depth * 14 };
  if (folder.isLoading) return <div style={pad} className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading…</div>;
  if (folder.error) return <div style={pad} className="py-1 text-xs text-destructive">{folder.error.message}</div>;
  const entries = folder.data?.entries ?? [];
  if (entries.length === 0) return <div style={pad} className="py-1 text-xs italic text-muted-foreground">empty</div>;
  return (
    <>
      {entries.map((e) => {
        const full = join(path, e.name);
        const open = expanded.has(full);
        return (
          <div key={full}>
            <div className="group/row relative">
            <button
              type="button"
              onClick={() => (e.dir ? onToggle(full) : onOpen(full))}
              title={full}
              aria-expanded={e.dir ? open : undefined}
              style={pad}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left font-mono text-[12px] transition-colors",
                selected === full ? "bg-primary/12 text-primary" : "text-foreground/85 hover:bg-secondary",
                e.name.startsWith(".") && selected !== full && "text-muted-foreground",
              )}
            >
              {e.dir ? (open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />) : <span className="w-3 shrink-0" />}
              {e.dir ? (open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-primary/80" />) : <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate pr-5">{e.name}</span>
            </button>
            <a
              href={downloadHref(target, full, e.dir)}
              download
              title={e.dir ? `Download ${e.name} as .tar.gz` : `Download ${e.name}`}
              aria-label={e.dir ? `Download folder ${e.name}` : `Download ${e.name}`}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
            >
              <Download className="h-3 w-3" />
            </a>
            </div>
            {e.dir && open && <FolderChildren {...{ target, expanded, selected, onToggle, onOpen }} path={full} depth={depth + 1} />}
          </div>
        );
      })}
      {folder.data?.truncated && <div style={pad} className="py-1 text-[11px] text-muted-foreground">Showing the first 2,000 entries</div>}
    </>
  );
});

// ── file viewer ───────────────────────────────────────────

const FileView: FC<{ target: PodFilesTarget; path: string; line?: number }> = ({ target, path, line }) => {
  const file = useFile(target, path);
  const scroller = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => (file.data?.text ?? "").replace(/\n$/, "").split("\n"), [file.data?.text]);

  useLayoutEffect(() => {
    if (line && scroller.current) scroller.current.scrollTop = Math.max(0, (line - 6) * LINE_PX);
  }, [line, file.data]);

  if (file.isLoading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening {path}…</div>;
  if (file.error) return <Problem message={file.error.message} />;
  const f = file.data!;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={path}>{path}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{humanSize(f.size)}{!f.binary && ` · ${lines.length.toLocaleString()} lines`}</span>
        <a
          href={downloadHref(target, path, false)}
          download
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Download className="h-3 w-3" />Download
        </a>
        {!f.binary && (
          <button
            type="button"
            onClick={() => { void navigator.clipboard?.writeText(f.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Copy className="h-3 w-3" />{copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {f.truncated && <div className="shrink-0 border-b border-border bg-warning/10 px-3 py-1.5 text-[11px] text-foreground">Large file: showing the first 512 KB.</div>}
      {f.binary ? (
        <Problem message="This is a binary file, so it isn't shown here. Use Download to save it." />
      ) : (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto bg-surface-inset">
          {line && <div aria-hidden className="pointer-events-none absolute inset-x-0 bg-primary/15" style={{ top: 8 + (line - 1) * LINE_PX, height: LINE_PX }} />}
          <div className="flex min-w-max py-2 font-mono text-[12px]" style={{ lineHeight: `${LINE_PX}px` }}>
            <pre aria-hidden className="select-none border-r border-border/60 px-3 text-right text-muted-foreground/60">
              {lines.map((_, i) => i + 1).join("\n")}
            </pre>
            <pre className="px-4 text-foreground/90">{f.text || " "}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// ── search results ────────────────────────────────────────

const Results: FC<{ target: PodFilesTarget; search: FileSearch; onOpen: (path: string, line?: number) => void }> = ({ target, search, onOpen }) => {
  const r = useFileSearch(target, search);
  if (r.isLoading) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Searching {search.path}…</div>;
  if (r.error) return <Problem message={r.error.message} />;
  const results = r.data?.results ?? [];
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 border-b border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        {results.length === 0 ? "No matches" : `${results.length}${r.data?.capped ? "+" : ""} ${search.mode === "name" ? "files" : "matches"}`} for
        <span className="mx-1 font-mono text-foreground">{search.q}</span>in <span className="font-mono text-foreground">{search.path}</span>
        {!search.all && <span className="ml-1">· skipping node_modules, .git, vendor</span>}
      </div>
      <ul>
        {results.map((m, i) => (
          <li key={`${m.path}:${m.line ?? i}`}>
            <button type="button" onClick={() => onOpen(m.path, m.line)} className="block w-full border-b border-border/50 px-3 py-1.5 text-left hover:bg-secondary">
              <span className="block truncate font-mono text-[12px] text-primary">{m.path}{m.line ? `:${m.line}` : ""}</span>
              {m.text !== undefined && <span className="block truncate font-mono text-[12px] text-foreground/80">{m.text.trim()}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ── the browser ───────────────────────────────────────────

/** Browse, open and search a container's files. Read-only; runs `kubectl exec` (desktop only). */
export default function PodFileBrowser({ pod, context, namespace }: { pod: string; context: string; namespace: string }) {
  const containers = usePodContainers({ pod, context, namespace });
  const [container, setContainer] = useState<string>();
  const [root, setRoot] = useState<string>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ path: string; line?: number } | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"content" | "name">("content");
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState<FileSearch | null>(null);

  useEffect(() => {
    if (!container && containers.data?.length) setContainer(containers.data[0].name);
  }, [containers.data, container]);

  const target: PodFilesTarget = { pod, context, namespace, container };
  // the first listing (no path) resolves the container's working directory
  const start = useFolder(target, root === undefined ? undefined : root, root === undefined);
  useEffect(() => {
    if (root === undefined && start.data) setRoot(start.data.path);
  }, [start.data, root]);

  const switchContainer = (name: string) => {
    setContainer(name);
    setRoot(undefined);
    setExpanded(new Set());
    setOpen(null);
    setSearch(null);
  };
  const goTo = (path: string) => {
    setRoot(path);
    setExpanded(new Set());
  };
  const toggle = (path: string) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(path)) n.delete(path); else n.add(path);
    return n;
  });
  const openFile = (path: string, line?: number) => {
    setOpen({ path, line });
    setSearch(null);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (root && query.trim()) setSearch({ path: root, q: query.trim(), mode, all });
  };

  if (containers.error) return <Problem message={containers.error.message} />;
  if (root === undefined && start.error) return <Problem message={start.error.message} />;

  const crumbs = (root ?? "").split("/").filter(Boolean);

  return (
    <div className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {containers.data && containers.data.length > 1 && (
          <select
            value={container}
            onChange={(e) => switchContainer(e.target.value)}
            aria-label="Container"
            className="h-8 rounded-lg border border-border bg-background px-2 font-mono text-xs"
          >
            {containers.data.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        <nav aria-label="Folder" className="flex min-w-0 flex-1 items-center overflow-x-auto font-mono text-xs">
          <button type="button" onClick={() => goTo("/")} className="rounded px-1 py-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">/</button>
          {crumbs.map((c, i) => {
            const p = `/${crumbs.slice(0, i + 1).join("/")}`;
            return (
              <span key={p} className="flex shrink-0 items-center">
                {i > 0 && <span className="text-muted-foreground/50">/</span>}
                <button type="button" onClick={() => goTo(p)} className={cn("rounded px-1 py-0.5 hover:bg-secondary", i === crumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>{c}</button>
              </span>
            );
          })}
        </nav>
        {root && root !== "/" && (
          <a
            href={downloadHref(target, root, true)}
            download
            title={`Download ${root} as .tar.gz`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />Download folder
          </a>
        )}
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <div role="radiogroup" aria-label="Search in" className="flex rounded-lg border border-border bg-muted/50 p-0.5 text-[11px]">
            {(["content", "name"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-2 py-0.5", mode === m ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
                {m === "content" ? "Text" : "File names"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Also search node_modules, .git, vendor, __pycache__, .venv">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
            Include dependencies
          </label>
          <label className="focus-frame flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2 focus-within:border-primary/50">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${root ?? "…"}`}
              aria-label="Search files"
              className="w-48 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {search && <button type="button" onClick={() => setSearch(null)} aria-label="Close search results" className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
          </label>
        </form>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-auto border-r border-border p-1.5">
          {root !== undefined && root !== "/" && (
            <button type="button" onClick={() => goTo(parentOf(root))} className="mb-0.5 flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] font-mono text-[12px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Folder className="h-3.5 w-3.5" />..
            </button>
          )}
          {root === undefined ? (
            <div className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Connecting to the container…</div>
          ) : (
            <FolderChildren target={target} path={root} depth={0} expanded={expanded} selected={open?.path ?? null} onToggle={toggle} onOpen={(p) => openFile(p)} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {search ? (
            <Results target={target} search={search} onOpen={openFile} />
          ) : open ? (
            <FileView key={open.path} target={target} path={open.path} line={open.line} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <FolderOpen className="h-6 w-6" />
              Pick a file on the left, or search this folder.
              <span className="text-xs">Read-only. Files are read through kubectl exec as the container's user.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
