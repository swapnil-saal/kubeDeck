import { StatusBadge } from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, ShieldOff, Columns3, RotateCcw, Inbox } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { K8sError } from "@/hooks/use-k8s";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Column<T> {
  /** Stable id for visibility persistence (defaults to header). */
  id?: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  minWidth?: string;
  nowrap?: boolean;
  /** When true, column cannot be hidden (e.g. resource name). */
  required?: boolean;
  /** Start hidden until the user enables it (default false). */
  defaultHidden?: boolean;
}

interface ResourceTableProps<T> {
  data?: T[];
  columns: Column<T>[];
  isLoading: boolean;
  isError?: boolean;
  error?: Error | null;
  searchKey?: keyof T;
  accentColor?: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  /**
   * Persist column visibility under this key (localStorage).
   * Prefer one id per resource kind (e.g. "pods", "deployments").
   */
  tableId?: string;
  /** Drop the Namespace column — redundant when the whole view is one namespace. */
  hideNamespace?: boolean;
  /** Plural noun for the empty state, e.g. "ingresses". */
  emptyLabel?: string;
}

function formatAge(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return formatDistanceToNow(date, { addSuffix: false })
      .replace("about ", "~")
      .replace(" hours", "h")
      .replace(" hour", "h")
      .replace(" minutes", "m")
      .replace(" minute", "m")
      .replace(" days", "d")
      .replace(" day", "d")
      .replace(" months", "mo")
      .replace(" month", "mo");
  } catch {
    return timestamp;
  }
}

function resolveColId<T>(col: Column<T>, index: number): string {
  if (col.id) return col.id;
  if (col.accessorKey) return String(col.accessorKey);
  return col.header.toLowerCase().replace(/\s+/g, "-") || `col-${index}`;
}

function storageKey(tableId: string): string {
  return `kubedeck.tableColumns.${tableId}`;
}

function loadHidden(tableId: string | undefined, defaults: string[]): Set<string> {
  const base = new Set(defaults);
  if (!tableId) return base;
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as { hidden?: string[] };
    if (Array.isArray(parsed.hidden)) return new Set(parsed.hidden);
  } catch { /* ignore */ }
  return base;
}

function saveHidden(tableId: string | undefined, hidden: Set<string>) {
  if (!tableId) return;
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify({ hidden: Array.from(hidden) }));
  } catch { /* ignore */ }
}

export function ResourceTable<T extends { name: string; status?: string }>({
  data,
  columns: allColumns,
  isLoading,
  isError,
  error,
  searchKey = "name",
  search: controlledSearch,
  onSearchChange,
  tableId,
  hideNamespace,
  emptyLabel,
}: ResourceTableProps<T>) {
  const columns = useMemo(
    () => (hideNamespace ? allColumns.filter((c) => c.accessorKey !== "namespace") : allColumns),
    [allColumns, hideNamespace],
  );
  const [internalSearch, setInternalSearch] = useState("");
  const search = controlledSearch ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const isForbidden = error instanceof K8sError && error.isForbidden;

  const columnMeta = useMemo(
    () =>
      columns.map((col, i) => ({
        col,
        id: resolveColId(col, i),
        required: col.required === true || i === 0 || col.accessorKey === "name",
      })),
    [columns],
  );

  const defaultHiddenIds = useMemo(
    () => columnMeta.filter((c) => c.col.defaultHidden && !c.required).map((c) => c.id),
    [columnMeta],
  );

  const [hidden, setHidden] = useState<Set<string>>(() => loadHidden(tableId, defaultHiddenIds));

  // Reload prefs when switching resource tabs
  useEffect(() => {
    setHidden(loadHidden(tableId, defaultHiddenIds));
    // only when table identity changes; defaultHiddenIds is stable per tableId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  const toggleColumn = useCallback(
    (id: string, required: boolean) => {
      if (required) return;
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        saveHidden(tableId, next);
        return next;
      });
    },
    [tableId],
  );

  const resetColumns = useCallback(() => {
    const next = new Set(defaultHiddenIds);
    setHidden(next);
    saveHidden(tableId, next);
  }, [defaultHiddenIds, tableId]);

  const visibleCols = useMemo(
    () => columnMeta.filter((c) => c.required || !hidden.has(c.id)),
    [columnMeta, hidden],
  );

  const filteredData = useMemo(
    () =>
      data?.filter((item) =>
        String(item[searchKey]).toLowerCase().includes(search.toLowerCase()),
      ),
    [data, searchKey, search],
  );

  const colCount = visibleCols.length;
  const hiddenCount = columnMeta.length - visibleCols.length;

  return (
    <div className="card-elevated overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <div className="relative w-80 max-w-[50%]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            placeholder="Filter resources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-8 pl-9 pr-3 bg-secondary/50 border border-border/50 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {columnMeta.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border/60 bg-secondary/40 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
                  title="Show or hide columns"
                >
                  <Columns3 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Columns</span>
                  {hiddenCount > 0 && (
                    <span className="tabular-nums text-[10px] text-primary font-semibold">
                      −{hiddenCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                  Visible fields
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columnMeta
                  .filter(({ col }) => col.header.trim().length > 0)
                  .map(({ col, id, required }) => {
                  const checked = required || !hidden.has(id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={id}
                      checked={checked}
                      disabled={required}
                      onCheckedChange={() => toggleColumn(id, required)}
                      onSelect={(e) => e.preventDefault()}
                      className="text-xs"
                    >
                      {col.header}
                      {required && (
                        <span className="ml-auto pl-2 text-[9px] text-muted-foreground/70">locked</span>
                      )}
                    </DropdownMenuCheckboxItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs text-muted-foreground gap-1.5"
                  onClick={resetColumns}
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset columns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="text-xs text-muted-foreground tabular-nums">
            {isForbidden ? (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-semibold text-[10px]">
                <ShieldOff size={13} /> Access denied
              </span>
            ) : isError ? (
              <span className="text-red-600 dark:text-red-400 flex items-center gap-1.5 font-semibold text-[10px]">
                <AlertTriangle size={13} /> Fetch error
              </span>
            ) : (
              <span className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-[10px] font-semibold">
                {filteredData?.length ?? 0} resources
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {isForbidden ? (
          <div className="px-5 py-16 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 mb-3">
              <ShieldOff className="w-6 h-6 text-amber-500" />
            </div>
            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Access Denied</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
              {error?.message || "Your service account does not have permission to list resources in this namespace."}
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-3">
              Try switching to a namespace you have access to.
            </p>
          </div>
        ) : isError ? (
          <div className="px-5 py-16 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10 mb-3">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Fetch Failed</p>
            <p className="text-xs text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
              {error?.message || "Failed to fetch resources. Check cluster connectivity."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm table-auto">
            <thead>
              <tr className="bg-secondary/40 border-b border-border/50">
                {visibleCols.map(({ col, id }) => (
                  <th
                    key={id}
                    className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap"
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {visibleCols.map(({ id }) => (
                      <td key={id} className="px-4 py-3">
                        <Skeleton className="h-3.5 bg-muted rounded" style={{ width: `${40 + ((i * 17 + id.length * 3) % 40)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredData?.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(colCount, 1)} className="px-4 py-14 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Inbox className="h-5 w-5" /></span>
                      <p className="text-sm font-medium text-foreground">
                        {search ? `No ${emptyLabel ?? "resources"} match “${search}”` : `No ${emptyLabel ?? "resources"} in this scope`}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {search ? "Clear the filter to see everything." : "Nothing of this kind exists here. Try another namespace from the scope menu in the header."}
                      </p>
                      {search && (
                        <button type="button" onClick={() => setSearch("")} className="mt-1 rounded-md border border-border px-3 py-1 text-xs text-foreground transition-colors hover:bg-muted">Clear filter</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData?.map((item, i) => (
                  <motion.tr
                    key={item.name + String(i)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.3), duration: 0.15 }}
                    className="group border-b border-border/50 hover:bg-primary/[0.03] transition-colors cursor-default"
                  >
                    {visibleCols.map(({ col, id }) => (
                      <td
                        key={id}
                        className="px-4 py-2.5 text-muted-foreground whitespace-nowrap max-w-[350px]"
                      >
                        <div className="flex items-center">
                          {col.cell
                            ? col.cell(item)
                            : col.accessorKey === "status"
                              ? <StatusBadge status={String(item[col.accessorKey!])} resourceName={item.name} />
                              : col.accessorKey === "age"
                                ? <span className="text-muted-foreground text-xs">{formatAge(String(item[col.accessorKey!]))}</span>
                                : <span className="truncate">{String(item[col.accessorKey!] ?? "-")}</span>}
                        </div>
                      </td>
                    ))}
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
