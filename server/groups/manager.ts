/**
 * The groups an admin defined, kept in memory so every kubectl call can find a person's cluster
 * access without a database round trip. Uploaded kubeconfigs are decrypted into private files that
 * kubectl reads. Every change goes through here: it is checked, saved, the memory copy replaced, and
 * `group.changed` emitted.
 */
import { ALL_PERMISSIONS, groupIdFor, permissionsOf, type AppPermissions, type ClusterAccess, type CreateGroupInput, type Group, type UpdateGroupInput } from "@shared/groups";
import { clusterFile, clusterNames } from "../clusters";
import { emit } from "../events";
import type { ClusterGrant } from "../identity";
import { decrypt, encrypt, secretKey } from "../secrets";
import { clearCredentialsFiles, CredentialsError, checkKubeconfig, normalizeKubeconfig, writeCredentialsFile } from "../kubeconfig-files";
import type { GroupStore, StoredGroup } from "./store";

export class GroupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let store: GroupStore | null = null;
let groups: StoredGroup[] = [];
let key: Buffer | null = null;
/** `<group>\0<context>` → the decrypted kubeconfig's file */
const files = new Map<string, string>();
const fileKey = (group: string, context: string) => `${group}\u0000${context}`;

/** Decrypt every uploaded kubeconfig into its file; one that cannot be decrypted is skipped (its calls fail). */
function writeFiles(): void {
  clearCredentialsFiles("groups");
  files.clear();
  for (const g of groups) {
    for (const [context, sealed] of Object.entries(g.secrets)) {
      try {
        files.set(fileKey(g.id, context), writeCredentialsFile("groups", `${g.id}-${context}`, decrypt(sealed, key!)));
      } catch {
        console.warn(`[kubedeck] Group ${g.name}: the kubeconfig for ${context} cannot be decrypted (was KUBEDECK_AUTH_SECRET changed?). Upload it again.`);
      }
    }
  }
}

export async function startGroups(s: GroupStore, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  store = s;
  key = secretKey(env, undefined, "groups");
  groups = await s.all();
  writeFiles();
}

export function stopGroups(): void {
  store = null;
  groups = [];
  files.clear();
  clearCredentialsFiles("groups");
}

const need = (): GroupStore => {
  if (!store) throw new GroupError(503, "Groups need KubeDeck's database.");
  return store;
};

const publicGroup = ({ secrets: _secrets, ...g }: StoredGroup): Group => g;
export const listGroups = (): Group[] => groups.map(publicGroup);
export const groupIds = (): string[] => groups.map((g) => g.id);
const find = (id: string): StoredGroup => {
  const g = groups.find((x) => x.id === id);
  if (!g) throw new GroupError(404, `No group "${id}".`);
  return g;
};

/** A group's access on a cluster as kubectl flags' source; a connection that cannot be read fails closed. */
const toGrant = (g: StoredGroup, a: ClusterAccess): ClusterGrant =>
  a.as === "serviceaccount"
    ? { as: "serviceaccount", kubeconfig: clusterFile(a.context) ?? "/dev/null", namespace: a.namespace, serviceAccount: a.serviceAccount }
    : { as: "credentials", kubeconfig: files.get(fileKey(g.id, a.context)) ?? "/dev/null" };

/** The clusters someone in `memberOf` can reach: those their groups have a service account on, that still exist. */
export function clustersFor(memberOf: string[]): string[] {
  const known = new Set(clusterNames());
  return [...new Set(groups.filter((g) => memberOf.includes(g.id)).flatMap((g) => g.access.map((a) => a.context)))].filter((c) => known.has(c)).sort();
}

/** The names of the groups that have a service account on `cluster`. */
export const groupsUsing = (cluster: string): string[] => groups.filter((g) => g.access.some((a) => a.context === cluster)).map((g) => g.name);

/**
 * Every service account a person in `memberOf` has on `context`, in the groups' order (the order kubectl
 * tries them). Credentials that could not be decrypted fail closed.
 */
export function clusterGrantsFor(memberOf: string[], context: string): ClusterGrant[] {
  if (!context) return [];
  return [...groups].sort((a, b) => a.position - b.position)
    .filter((g) => memberOf.includes(g.id))
    .flatMap((g) => g.access.filter((a) => a.context === context).map((a) => toGrant(g, a)));
}

/** The first of them (what a call starts as), or undefined when no group covers the cluster. */
export function clusterAccessFor(memberOf: string[], context: string): ClusterGrant | undefined {
  return clusterGrantsFor(memberOf, context)[0];
}

/** What someone in `memberOf` may use in KubeDeck: a feature any of their groups allows. */
export function appPermissionsFor(memberOf: string[]): AppPermissions {
  return permissionsOf(groups, memberOf);
}

/**
 * The access to store and its sealed kubeconfigs: a new upload is checked (what it may contain, and
 * that the cluster accepts it); a credentials entry without one keeps what `before` had for that cluster.
 */
async function sealAccess(input: ClusterAccess[], before: StoredGroup | undefined): Promise<Pick<StoredGroup, "access" | "secrets">> {
  const access: ClusterAccess[] = [];
  const secrets: Record<string, string> = {};
  const known = new Set(clusterNames());
  for (const a of input) {
    if (!known.has(a.context)) throw new GroupError(400, `There is no cluster named ${a.context}. Add it under Settings → Clusters first.`);
    if (a.as === "serviceaccount") { access.push(a); continue; }
    if (!a.kubeconfig) {
      const kept = before?.access.find((x) => x.context === a.context && x.as === "credentials");
      if (!kept || !before?.secrets[a.context]) throw new GroupError(400, `Upload a kubeconfig for ${a.context}.`);
      access.push(kept);
      secrets[a.context] = before.secrets[a.context];
      continue;
    }
    try {
      const { yaml, server } = normalizeKubeconfig(a.kubeconfig, a.context);
      const identity = await checkKubeconfig("groups", yaml, a.context);
      access.push({ context: a.context, as: "credentials", identity, server });
      secrets[a.context] = encrypt(yaml, key!);
    } catch (err) {
      if (err instanceof CredentialsError) throw new GroupError(400, `${a.context}: ${err.message}`);
      throw err;
    }
  }
  return { access, secrets };
}

async function reload(id: string, change: "created" | "updated" | "deleted" | "reordered", by: string): Promise<void> {
  groups = await need().all();
  writeFiles();
  emit("group.changed", { id, change, by });
}

export async function createGroup(input: Required<Pick<CreateGroupInput, "name">> & Omit<CreateGroupInput, "name">, by: string): Promise<Group> {
  const s = need();
  const taken = groupIds();
  if (input.id && taken.includes(input.id)) throw new GroupError(409, `A group with the id "${input.id}" already exists.`);
  const group: StoredGroup = {
    id: input.id ?? groupIdFor(input.name, taken),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    position: groups.length === 0 ? 0 : Math.max(...groups.map((g) => g.position)) + 1,
    permissions: { ...ALL_PERMISSIONS, ...input.permissions },
    ...(await sealAccess(input.access ?? [], undefined)),
  };
  await s.save(group, by);
  await reload(group.id, "created", by);
  return publicGroup(find(group.id));
}

export async function updateGroup(id: string, input: UpdateGroupInput, by: string): Promise<Group> {
  const s = need();
  const g = find(id);
  const sealed = input.access ? await sealAccess(input.access, g) : { access: g.access, secrets: g.secrets };
  const permissions = { ...g.permissions, ...input.permissions };
  await s.save({ ...g, name: input.name ?? g.name, description: input.description ?? g.description, permissions, ...sealed }, by);
  await reload(id, "updated", by);
  return publicGroup(find(id));
}

/** Refused while anyone is still in the group: their accounts carry its id. */
export async function deleteGroup(id: string, members: number, by: string): Promise<void> {
  const s = need();
  const g = find(id);
  if (members > 0) throw new GroupError(409, `${g.name} still has ${members} ${members === 1 ? "member" : "members"}. Remove them from the group first.`);
  await s.remove(id);
  await reload(id, "deleted", by);
}

/** A new order for the list (the first group covering a cluster wins); ids left out keep their place after. */
export async function reorderGroups(ids: string[], by: string): Promise<Group[]> {
  const s = need();
  const known = groupIds();
  const order = [...ids.filter((id) => known.includes(id)), ...known.filter((id) => !ids.includes(id))];
  await s.reorder(order);
  await reload("", "reordered", by);
  return listGroups();
}

/**
 * Groups that accounts already carry but nobody defined (from before groups were managed here):
 * define each, named after its id, so the Groups page shows them. Never touches existing groups.
 */
export async function adoptGroups(ids: string[], by: string): Promise<string[]> {
  if (!store) return [];
  const known = new Set(groupIds());
  const missing = [...new Set(ids)].filter((id) => !known.has(id)).sort();
  for (const id of missing) await createGroup({ id, name: id, description: "", access: [] }, by);
  return missing;
}
