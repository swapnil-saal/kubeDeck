import { useMutation, useQueryClient, type InvalidateQueryFilters } from "@tanstack/react-query";

/** A mutation that, once it succeeds, refreshes every query the given filters match. */
export function useInvalidatingMutation<V, R>(fn: (v: V) => Promise<R>, refresh: InvalidateQueryFilters[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const filter of refresh) void qc.invalidateQueries(filter);
    },
  });
}
