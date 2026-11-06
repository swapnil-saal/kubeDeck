import { useMemo } from "react";
import { ResourceTable, type Column } from "@/components/ResourceTable";
import { useGenericList } from "@/hooks/use-k8s";
import { useHashParams } from "@/hooks/use-hash-params";
import { useResourceNav } from "@/hooks/use-resource-nav";

interface Row {
  name: string;
  namespace: string;
  status?: string;
  cells: string[];
}

/** Wide columns that are rarely what you scan a list for; one click in the column menu brings them back. */
const HIDDEN_BY_DEFAULT = new Set(["SELECTOR", "LABELS", "NOMINATED NODE", "READINESS GATES", "GATEWAY"]);

const UNIT_SECONDS: Record<string, number> = { y: 31_536_000, d: 86_400, h: 3_600, m: 60, s: 1 };

/** kubectl's relative ages ("462d", "5h12m", "3y45d") as seconds, for sorting. */
export function ageSeconds(age: string): number | null {
  const parts = [...age.matchAll(/(\d+)([ydhms])/g)];
  if (parts.length === 0) return null;
  return parts.reduce((sum, [, n, unit]) => sum + Number(n) * UNIT_SECONDS[unit], 0);
}

/** "NOMINATED NODE" → "Nominated node" */
const title = (col: string) => col.charAt(0) + col.slice(1).toLowerCase();

/**
 * Any resource kind as a table, with the columns `kubectl get -o wide` prints for it (a CRD's own
 * printer columns included). Names open the detail page, which works for every kind.
 */
export function GenericList({ type, label, context, namespace, clusterScoped }: {
  /** api-resource id, e.g. "replicasets" or "certificates.cert-manager.io" */
  type: string;
  label: string;
  context: string;
  namespace: string;
  clusterScoped?: boolean;
}) {
  const { get, set } = useHashParams();
  const { openDetail } = useResourceNav();
  const query = useGenericList(type, context, clusterScoped ? "" : namespace);

  const { rows, columns } = useMemo(() => {
    const cols = query.data?.columns ?? [];
    const at = (c: string) => cols.indexOf(c);
    const nameAt = at("NAME");
    const nsAt = at("NAMESPACE");
    const statusAt = at("STATUS");
    const rows: Row[] = (query.data?.rows ?? []).map((cells) => ({
      name: cells[nameAt] ?? "",
      namespace: nsAt >= 0 ? cells[nsAt] : clusterScoped ? "" : namespace,
      status: statusAt >= 0 ? cells[statusAt] : undefined,
      cells,
    }));
    const columns: Column<Row>[] = cols.map((c, i): Column<Row> => {
      if (i === nameAt) {
        return {
          id: "name", header: "Name", accessorKey: "name",
          cell: (r) => (
            <button
              type="button"
              onClick={() => openDetail(type, r.name, r.namespace || undefined)}
              className="text-left font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              {r.name}
            </button>
          ),
        };
      }
      if (i === nsAt) return { id: "namespace", header: "NS", accessorKey: "namespace", cell: (r) => <span className="text-[10px] text-muted-foreground">{r.namespace}</span> };
      if (i === statusAt) return { id: "status", header: "Status", accessorKey: "status" };
      return {
        id: `c${i}:${c}`,
        header: title(c),
        defaultHidden: HIDDEN_BY_DEFAULT.has(c),
        sortValue: (r) => {
          const v = r.cells[i] ?? "";
          if (c === "AGE" || c === "LAST SEEN") return ageSeconds(v);
          return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        },
        cell: (r) => <span className="truncate text-xs" title={r.cells[i]}>{r.cells[i] || "–"}</span>,
      };
    });
    return { rows, columns };
  }, [query.data, type, namespace, clusterScoped, openDetail]);

  return (
    <ResourceTable
      tableId={`generic:${type}`}
      hideNamespace={!clusterScoped && namespace !== "all"}
      emptyLabel={label.toLowerCase()}
      search={get("q") || ""}
      onSearchChange={(q) => set("q", q || null)}
      data={query.data ? rows : undefined}
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      columns={columns}
    />
  );
}
