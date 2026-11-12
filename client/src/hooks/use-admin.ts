import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildUrl } from "@shared/routes";
import {
  adminPaths,
  auditListSchema,
  userListSchema,
  type AdminUser,
  type AuditList,
  type CreateUserInput,
  type UpdateUserInput,
  type UserList,
} from "@shared/admin";
import { requestJson } from "@/lib/request-json";

const USERS = [adminPaths.users];

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: USERS,
    queryFn: async (): Promise<UserList> => userListSchema.parse(await requestJson("GET", adminPaths.users)),
    enabled,
    staleTime: 10_000,
  });
}

/** Every user change refreshes the list; changing your own account also refreshes who you are. */
function useUserMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: USERS });
      void qc.invalidateQueries({ queryKey: ["/api/mode"] });
    },
  });
}

const userUrl = (path: string, id: string) => buildUrl(path, { id });

export const useCreateUser = () => useUserMutation((v: CreateUserInput) => requestJson<AdminUser>("POST", adminPaths.users, v));
export const useUpdateUser = () => useUserMutation(({ id, ...v }: UpdateUserInput & { id: string }) => requestJson<AdminUser>("PATCH", userUrl(adminPaths.user, id), v));
export const useSetPassword = () => useUserMutation(({ id, password }: { id: string; password: string }) => requestJson("POST", userUrl(adminPaths.password, id), { password }));
export const useBanUser = () => useUserMutation(({ id, banned, reason }: { id: string; banned: boolean; reason?: string }) => requestJson("POST", userUrl(adminPaths.ban, id), { banned, reason }));
export const useSignOutEverywhere = () => useUserMutation((id: string) => requestJson("DELETE", userUrl(adminPaths.sessions, id)));
export const useDeleteUser = () => useUserMutation((id: string) => requestJson("DELETE", userUrl(adminPaths.user, id)));

/** Newest first, a page at a time; `user` narrows to one email. */
export function useAudit(user: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: [adminPaths.audit, user],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<AuditList> => {
      const q = new URLSearchParams({ limit: "100" });
      if (pageParam) q.set("before", String(pageParam));
      if (user) q.set("user", user);
      return auditListSchema.parse(await requestJson("GET", `${adminPaths.audit}?${q}`));
    },
    getNextPageParam: (last) => (last.more ? last.entries[last.entries.length - 1]?.id : undefined),
    enabled,
    staleTime: 5_000,
  });
}

/** Sign in with KubeDeck's own accounts. Resolves with an error message, or null when signed in. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const res = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  if (res.ok) return null;
  if (res.status === 429) return "Too many attempts. Wait a minute and try again.";
  const data = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  if (data.code === "INVALID_EMAIL_OR_PASSWORD" || res.status === 401) return "That email and password do not match an account.";
  if (data.code === "BANNED_USER" || res.status === 403) return data.message || "This account is blocked. Ask a KubeDeck admin.";
  return data.message || `Sign-in failed (${res.status}).`;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
}
