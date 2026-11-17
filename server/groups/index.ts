/**
 * KubeDeck groups (web mode): teams an admin defines under Settings → Groups, and per cluster the
 * identity each acts as (see shared/groups.ts). People's membership is kept on their accounts
 * (server/auth); identity.ts asks clusterAccessFor() on every kubectl call. This module owns the
 * `kubedeck_group` and `group_cluster_access` tables.
 */
export { adoptGroups, appPermissionsFor, clusterAccessFor, clusterGrantsFor, clustersFor, groupsUsing, createGroup, deleteGroup, GroupError, groupIds, listGroups, reorderGroups, startGroups, stopGroups, updateGroup } from "./manager";
export { registerGroupRoutes, type GroupRouteDeps } from "./routes";
export { databaseGroupStore, type GroupStore } from "./store";
