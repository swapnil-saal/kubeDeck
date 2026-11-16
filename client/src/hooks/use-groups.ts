import { useQuery } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import {
  groupListSchema,
  groupPaths,
  serviceAccountsInfoSchema,
  type CreateGroupInput,
  type Group,
  type GroupList,
  type UpdateGroupInput,
} from "@shared/groups";
import { getParsed, requestJson } from "@/lib/request-json";
import { useInvalidatingMutation } from "./use-invalidating-mutation";

const GROUPS = [groupPaths.list];

/** Settings → Groups, for admins. */
export function useGroups(enabled = true) {
  return useQuery({ queryKey: GROUPS, queryFn: getParsed(groupListSchema, groupPaths.list), enabled, staleTime: 10_000 });
}

/** A group change can change what anyone in it sees: refresh the groups, and who you are. */
const useGroupMutation = <V, R>(fn: (v: V) => Promise<R>) => useInvalidatingMutation(fn, [{ queryKey: GROUPS }, { queryKey: ["/api/mode"] }]);
const groupUrl = (id: string) => buildUrl(groupPaths.one, { id });

export const useCreateGroup = () => useGroupMutation((v: CreateGroupInput) => requestJson<Group>("POST", groupPaths.list, v));
export const useUpdateGroup = () => useGroupMutation(({ id, ...v }: UpdateGroupInput & { id: string }) => requestJson<Group>("PATCH", groupUrl(id), v));
export const useDeleteGroup = () => useGroupMutation((id: string) => requestJson("DELETE", groupUrl(id)));
export const useReorderGroups = () => useGroupMutation((ids: string[]) => requestJson<GroupList>("PUT", groupPaths.order, { ids }));

/** A namespace's service accounts as KubeDeck's credentials see them, and whether it may impersonate them. */
export function useServiceAccounts(context: string | undefined, namespace: string | undefined) {
  const url = `${buildUrl(groupPaths.serviceAccounts, { context: encodeURIComponent(context ?? "") })}?namespace=${encodeURIComponent(namespace ?? "")}`;
  return useQuery({
    queryKey: [groupPaths.serviceAccounts, context, namespace],
    queryFn: getParsed(serviceAccountsInfoSchema, url),
    enabled: !!context && !!namespace && /^[a-z0-9][a-z0-9.-]*$/.test(namespace),
    staleTime: 60_000,
    retry: false,
  });
}
