import { StatusBadge } from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, AlertTriangle, ShieldOff } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { K8sError } from "@/hooks/use-k8s";

interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  /** Hint for minimum width of this column, e.g. "180px" */
  minWidth?: string;
  /** If true, this column won't shrink and won't wrap */
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
  accentColor = "cyan"
}: ResourceTableProps<T>) {
  const [search, setSearch] = useState("");
  const isForbidden = error instanceof K8sError && error.isForbidden;

  const filteredData = data?.filter(item => 
    String(item[searchKey]).toLowerCase().includes(search.toLowerCase())
  );

  const colCount = columns.length;

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600" />
          <input 
            placeholder="filter resources..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-7 pl-8 pr-3 bg-white/[0.02] border border-white/[0.04] rounded-sm text-[11px] font-mono text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-cyan-500/20 transition-colors"
          />
        </div>
        <div className="text-[10px] text-slate-600 ml-auto font-mono tabular-nums">
          {isForbidden ? (
            <span className="text-amber-400 flex items-center gap-1"><ShieldOff className="w-3 h-3" /> access denied</span>
          ) : isError ? (
            <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> fetch error</span>
          ) : (
            <>{filteredData?.length ?? 0} resources</>
          )}
        </div>
      </div>

      {/* Table — real HTML table for auto column sizing */}
      <div className="rounded border border-white/[0.04] overflow-x-auto bg-[#080a10]/50">
        {isForbidden ? (
          <div className="px-4 py-16 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/5 border border-amber-500/10 mb-3">
              <ShieldOff className="w-5 h-5 text-amber-500/60" />
            </div>
            <p className="text-[12px] text-amber-400/80 font-mono font-bold">ACCESS DENIED</p>
            <p className="text-[10px] text-slate-600 mt-1.5 max-w-xs mx-auto leading-relaxed">
              {error?.message || "Your service account does not have permission to list resources in this namespace."}
            </p>
            <p className="text-[9px] text-slate-700 mt-3 font-mono">
              Try switching to a namespace you have access to.
            </p>
          </div>
        ) : isError ? (
          <div className="px-4 py-16 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-500/5 border border-red-500/10 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-500/60" />
            </div>
            <p className="text-[12px] text-red-400/80 font-mono font-bold">FETCH FAILED</p>
            <p className="text-[10px] text-slate-600 mt-1.5 max-w-sm mx-auto leading-relaxed">
              {error?.message || "Failed to fetch resources. Check cluster connectivity."}
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse text-[11px] font-mono table-auto">
            <thead>
              <tr className="bg-white/[0.015] border-b border-white/[0.04]">
                {columns.map((col, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.2em] font-bold text-slate-600 whitespace-nowrap"
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.02]">
                    {columns.map((_, j) => (
                      <td key={j} className="px-3 py-2.5">
                        <Skeleton className="h-3 bg-white/[0.03] rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredData?.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center">
                    <p className="text-[11px] text-slate-600 font-mono">No resources found</p>
                  </td>
                </tr>
              ) : (
                filteredData?.map((item, i) => (
                  <motion.tr
                    key={item.name + String(i)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.3), duration: 0.15 }}
                    className="group border-b border-white/[0.02] hover:bg-white/[0.015] transition-colors cursor-default"
                  >
                    {columns.map((col, j) => (
                      <td
                        key={j}
                        className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-[350px]"
                      >
                        <div className="flex items-center">
                          {col.cell 
                            ? col.cell(item) 
                            : col.accessorKey === 'status' 
                              ? <StatusBadge status={String(item[col.accessorKey!])} />
                              : col.accessorKey === 'age'
                                ? <span className="text-slate-600">{formatAge(String(item[col.accessorKey!]))}</span>
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
