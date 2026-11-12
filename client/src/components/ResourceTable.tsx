import { StatusBadge } from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, ShieldOff, Columns3, RotateCcw, Inbox, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import { K8sError } from "@/hooks/use-k8s";
import { cycleSort, loadSort, saveSort, sortRows, type SortState } from "@/lib/table-sort";
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
  /** What to sort by when it differs from the displayed value (e.g. severity for a status). */
  sortValue?: (item: T) => string | number | null | undefined;
  /** Set false to disable sorting (default: sortable when it has an accessorKey or sortValue). */
  sortable?: boolean;
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

/** Rows rendered at a time; the rest arrive with "Show more". */
const ROW_PAGE = 200;

/**
 * A key per row that survives refetches, sorting and filtering: namespace/name, with a counter only
 * for the rare repeat. Keys that change would make React remount the row.
 */
export function rowKeys(rows: { name: string; namespace?: string }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = r.namespace ? `${r.namespace}/${r.name}` : r.name;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  });
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

/** The columns this person chose to hide for this table, or null while they have not chosen. */
function loadHidden(tableId: string | undefined): Set<string> | null {
  if (!tableId) return null;
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { hidden?: string[] };
    if (Array.isArray(parsed.hidden)) return new Set(parsed.hidden);
  } catch { /* ignore */ }
  return null;
}

function saveHidden(tableId: string | undefined, hidden: Set<string>) {
  if (!tableId) return;
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify({ hidden: Array.from(hidden) }));
  } catch { /* ignore */ }
}

/** Skeleton cells: a kind whose columns come with its data (any kind kubectl prints) has none while loading. */
function skeletonColumnIds(visible: { id: string }[]): string[] {
  return visible.length > 0 ? visible.map(({ id }) => id) : ["name", "status", "age"];
}

/**
 * A new scope (namespace, context) is a new query with nothing in it yet: keep the rows on screen,
 * dimmed (`stale`), until its answer arrives, instead of flashing the skeleton and fading every row
 * in again. `isLoading` is left for a table with nothing at all to show.
 */
function useHeldWhileLoading<T>(data: T[] | undefined, loading: boolean) {
  const [lastData, setLastData] = useState(data);
  if (data && data !== lastData) setLastData(data);
  const stale = !data && loading && !!lastData;
  const shownData = stale ? lastData : data;
  return { shownData, stale, isLoading: loading && !shownData };
}

/**
 * Hidden columns: the person's choice once made (kept per table), until then the columns' own
 * defaults, which for a kind whose columns arrive with its data are only known once it loads.
 */
function useColumnVisibility(tableId: string | undefined, defaultHiddenIds: string[]) {
  const [chosen, setChosen] = useState(() => ({ tableId, hidden: loadHidden(tableId) }));
  if (chosen.tableId !== tableId) setChosen({ tableId, hidden: loadHidden(tableId) });
  const defaultsKey = defaultHiddenIds.join("\n");
  const hidden = useMemo(
    () => chosen.hidden ?? new Set(defaultHiddenIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen.hidden, defaultsKey],
  );

  const toggleColumn = useCallback(
    (id: string, required: boolean) => {
      if (required) return;
      const next = new Set(hidden);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(tableId, next);
      setChosen({ tableId, hidden: next });
    },
    [hidden, tableId],
  );

  const resetColumns = useCallback(() => {
    const next = new Set(defaultHiddenIds);
    setChosen({ tableId, hidden: next });
    saveHidden(tableId, next);
  }, [defaultHiddenIds, tableId]);

  return { hidden, toggleColumn, resetColumns };
}

export function ResourceTable<T extends { name: string; namespace?: string; status?: string }>({
  data,
  columns: allColumns,
  isLoading: loading,
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

  const { shownData, stale, isLoading } = useHeldWhileLoading(data, loading);

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

  const { hidden, toggleColumn, resetColumns } = useColumnVisibility(tableId, defaultHiddenIds);

  const visibleCols = useMemo(
    () => columnMeta.filter((c) => c.required || !hidden.has(c.id)),
    [columnMeta, hidden],
  );

  const [sort, setSort] = useState<SortState | null>(() => loadSort(tableId));
  useEffect(() => { setSort(loadSort(tableId)); }, [tableId]);
  const onSort = useCallback((id: string) => {
    setSort((cur) => {
      const next = cycleSort(cur, id);
      saveSort(tableId, next);
      return next;
    });
  }, [tableId]);

  const filteredData = useMemo(
    () => {
      const filtered = shownData?.filter((item) =>
        String(item[searchKey]).toLowerCase().includes(search.toLowerCase()),
      );
      const col = sort ? columnMeta.find((c) => c.id === sort.id)?.col : undefined;
      if (!filtered || !sort || !col) return filtered;
      const valueOf = col.sortValue ?? ((item: T) => (col.accessorKey ? (item as Record<string, unknown>)[col.accessorKey as string] : undefined));
      return sortRows(filtered, valueOf, sort.dir);
    },
    [shownData, searchKey, search, sort, columnMeta],
  );

  const colCount = visibleCols.length;
  const hiddenCount = columnMeta.length - visibleCols.length;

  // big lists (hundreds of ReplicaSets, events…) render in pages; search and sort still see every row
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
  useEffect(() => setRowLimit(ROW_PAGE), [search, tableId]);
  const shownRows = filteredData?.slice(0, rowLimit);
  const moreRows = (filteredData?.length ?? 0) - (shownRows?.length ?? 0);
  const keys = useMemo(() => rowKeys(shownRows ?? []), [shownRows]);
  const skeletonCols = skeletonColumnIds(visibleCols);

  return (
    <div className="card-elevated overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
        <div className="relative w-80 max-w-[50%]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            placeholder={`Filter ${emptyLabel ?? "resources"}…`}
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
              // the page heading shows the total; only a filter needs its own count
              search && shownData && (filteredData?.length ?? 0) !== shownData.length ? (
                <span className="bg-primary/10 text-primary border border-primary/20 px-2.5 py-1 rounded-full text-[10px] font-semibold">
                  {filteredData?.length ?? 0} of {shownData.length} match
                </span>
              ) : null
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
                {visibleCols.map(({ col, id }) => {
                  const sortable = col.sortable !== false && !!(col.accessorKey || col.sortValue) && !!col.header;
                  const active = sort?.id === id ? sort.dir : null;
                  return (
                    <th
                      key={id}
                      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : sortable ? "none" : undefined}
                      className="px-4 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-widest whitespace-nowrap"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => onSort(id)}
                          title={active === "asc" ? "Sorted ascending — click for descending" : active === "desc" ? "Sorted descending — click to clear" : `Sort by ${col.header}`}
                          className={`group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-widest transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}
                        >
                          {col.header}
                          {active === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : active === "desc" ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/sort:opacity-50 group-focus-visible/sort:opacity-50" />}
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody aria-busy={loading || undefined} className={stale ? "opacity-50" : undefined}>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {skeletonCols.map((id) => (
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
                shownRows?.map((item, i) => (
                  <tr key={keys[i]} className="group cursor-default border-b border-border/50 hover:bg-primary/[0.03]">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
        {!isLoading && moreRows > 0 && (
          <div className="flex items-center justify-center gap-2 border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">
            <span className="tabular-nums">Showing {shownRows?.length} of {filteredData?.length}</span>
            <button type="button" onClick={() => setRowLimit((n) => n + ROW_PAGE)} className="rounded-md border border-border px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted">
              Show {Math.min(ROW_PAGE, moreRows)} more
            </button>
            <button type="button" onClick={() => setRowLimit(Number.POSITIVE_INFINITY)} className="rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:text-foreground">
              Show all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
