import { StatusBadge } from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, ShieldOff } from "lucide-react";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { K8sError } from "@/hooks/use-k8s";

interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  minWidth?: string;
  nowrap?: boolean;
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

export function ResourceTable<T extends { name: string; status?: string }>({ 
  data, 
  columns, 
  isLoading,
  isError,
  error,
  searchKey = "name",
  search: controlledSearch,
  onSearchChange,
}: ResourceTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState("");
  const search = controlledSearch ?? internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;
  const isForbidden = error instanceof K8sError && error.isForbidden;

  const filteredData = useMemo(() => data?.filter(item => 
    String(item[searchKey]).toLowerCase().includes(search.toLowerCase())
  ), [data, searchKey, search]);

  const colCount = columns.length;

  return (
    <div className="card-elevated overflow-hidden">
      {/* Search bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            placeholder="Filter resources..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-10 pr-3 bg-muted/50 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
          />
        </div>
        <div className="text-xs text-muted-foreground ml-auto tabular-nums">
          {isForbidden ? (
            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 font-medium"><ShieldOff className="w-3.5 h-3.5" /> Access denied</span>
          ) : isError ? (
            <span className="text-red-600 dark:text-red-400 flex items-center gap-1.5 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> Fetch error</span>
          ) : (
            <span className="bg-primary/10 text-primary px-2.5 py-1 rounded-full text-[11px] font-semibold">{filteredData?.length ?? 0} resources</span>
          )}
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
              <tr className="bg-muted/40 border-b border-border">
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5 text-left text-[11px] font-medium text-muted-foreground whitespace-nowrap"
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
                    {columns.map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-3.5 bg-muted rounded" style={{ width: `${40 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredData?.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <p className="text-sm text-muted-foreground">No resources found</p>
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
                    {columns.map((col, j) => (
                      <td
                        key={j}
                        className="px-4 py-2.5 text-muted-foreground whitespace-nowrap max-w-[350px]"
                      >
                        <div className="flex items-center">
                          {col.cell 
                            ? col.cell(item) 
                            : col.accessorKey === 'status' 
                              ? <StatusBadge status={String(item[col.accessorKey!])} resourceName={item.name} />
                              : col.accessorKey === 'age'
                                ? <span className="text-muted-foreground text-xs">{formatAge(String(item[col.accessorKey!]))}</span>
                                : <span className="truncate">{String(item[col.accessorKey!] ?? "-")}</span>
                          }
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
