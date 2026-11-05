import { useQuery } from "@tanstack/react-query";

export interface ServerMode {
  mode: "desktop" | "web";
  /** a shared KubeDeck refuses scale / restart / edit / delete */
  readOnly: boolean;
  /** web mode: "proxy" = users sign in through the login proxy; "none" = no sign-in (KUBEDECK_AUTH=none) */
  auth?: "proxy" | "none";
  /** web mode: "user" = each person's own RBAC (impersonation); "shared" = KubeDeck's service account */
  access?: "user" | "shared";
  user?: { name: string; email: string } | null;
  /** podFiles: browse and search a container's files (kubectl exec); desktop only */
  features: { portForward: boolean; settingsEdit: boolean; ai: boolean; podFiles?: boolean };
}

/** Desktop is the default while loading, and when the endpoint is missing (older server). */
const DESKTOP: ServerMode = { mode: "desktop", readOnly: false, features: { portForward: true, settingsEdit: true, ai: true, podFiles: true } };

/** Whether this KubeDeck is the desktop app or a shared web service, and who is signed in. */
export function useServerMode(): ServerMode & { canWrite: boolean; aiEnabled: boolean } {
  const { data } = useQuery<ServerMode>({
    queryKey: ["/api/mode"],
    queryFn: async () => {
      const res = await fetch("/api/mode", { credentials: "include" });
      if (!res.ok) return DESKTOP;
      return (await res.json()) as ServerMode;
    },
    staleTime: Infinity,
    retry: false,
  });
  const m = data ?? DESKTOP;
  // an older server has no `ai` flag: treat that as "available"
  return { ...m, canWrite: !m.readOnly, aiEnabled: m.features.ai !== false };
}
