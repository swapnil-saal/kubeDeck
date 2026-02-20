import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { motion } from "framer-motion";

interface Column<T> {
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
}

interface ResourceTableProps<T> {
  data?: T[];
  columns: Column<T>[];
  isLoading: boolean;
  searchKey?: keyof T;
}

export function ResourceTable<T extends { name: string; status?: string }>({ 
  data, 
  columns, 
  isLoading,
  searchKey = "name"
}: ResourceTableProps<T>) {
  const [search, setSearch] = useState("");

  const filteredData = data?.filter(item => 
    String(item[searchKey]).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search resources..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary/30 border-primary/10 focus-visible:ring-primary/20"
          />
        </div>
        <div className="text-sm text-muted-foreground ml-auto">
          {filteredData?.length || 0} items
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-secondary/50">
            <TableRow className="hover:bg-transparent border-border/50">
              {columns.map((col, i) => (
                <TableHead key={i} className="h-10 text-xs uppercase font-semibold text-muted-foreground">
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-border/50">
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-24 bg-secondary/50" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredData?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  No resources found
                </TableCell>
              </TableRow>
            ) : (
              filteredData?.map((item, i) => (
                <motion.tr 
                  key={item.name}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="group border-border/50 hover:bg-primary/5 transition-colors"
                >
                  {columns.map((col, j) => (
                    <TableCell key={j} className="py-3 font-mono text-sm text-foreground/80 group-hover:text-foreground">
                      {col.cell 
                        ? col.cell(item) 
                        : col.accessorKey === 'status' 
                          ? <StatusBadge status={String(item[col.accessorKey!])} />
                          : String(item[col.accessorKey!])
                      }
                    </TableCell>
                  ))}
                </motion.tr>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
