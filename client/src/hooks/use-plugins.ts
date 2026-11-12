import { useQuery, type Query } from "@tanstack/react-query";
import {
  pluginInfoSchema,
  pluginListSchema,
  pluginPaths,
  pluginStatusSchema,
  type PluginCreate,
  type PluginInfo,
  type PluginStatus,
  type PluginUpdate,
} from "@shared/plugins";
import { tracesPaths } from "@shared/traces";
import { getParsed, requestJson } from "@/lib/request-json";
import { useInvalidatingMutation } from "./use-invalidating-mutation";

const LIST = [pluginPaths.list];

const pluginUrl = (path: string, id: string) => path.replace(":id", encodeURIComponent(id));

/** Queries whose answer depends on a plugin being on: traces, trace status, Grafana, log history. */
const dependsOnPlugins = (q: Query) => {
  const key = String(q.queryKey[0]);
  return key.startsWith("/api/traces") || key === tracesPaths.logs;
};

/** Every plugin, its status and settings (settings only for someone who may manage them). */
export const usePlugins = () => useQuery({ queryKey: LIST, queryFn: getParsed(pluginListSchema, pluginPaths.list), staleTime: 10_000 });

/** Any change refreshes the list, and whatever the app shows because a plugin is on. */
const usePluginMutation = <V, R>(fn: (v: V) => Promise<R>) => useInvalidatingMutation(fn, [{ queryKey: LIST }, { predicate: dependsOnPlugins }]);

export const useUpdatePlugin = () =>
  usePluginMutation(async ({ id, ...update }: PluginUpdate & { id: string }): Promise<PluginInfo> =>
    pluginInfoSchema.parse(await requestJson("PUT", pluginUrl(pluginPaths.one, id), update)));

/** A fresh check of a plugin that is on; the list picks up the new status too. */
export const useTestPlugin = () =>
  useInvalidatingMutation(async (id: string): Promise<PluginStatus> =>
    pluginStatusSchema.parse(await requestJson("POST", pluginUrl(pluginPaths.test, id))), [{ queryKey: LIST }]);

export const useCreatePlugin = () =>
  usePluginMutation(async (create: PluginCreate): Promise<PluginInfo> =>
    pluginInfoSchema.parse(await requestJson("POST", pluginPaths.list, create)));

export const useRemovePlugin = () =>
  usePluginMutation((id: string) => requestJson<{ ok: true }>("DELETE", pluginUrl(pluginPaths.one, id)));
