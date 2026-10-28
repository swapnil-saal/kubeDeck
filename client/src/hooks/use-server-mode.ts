import { useQuery } from "@tanstack/react-query";

export interface ServerMode {
  mode: "desktop" | "web";
  /** a shared KubeDeck refuses scale / restart / edit / delete */
  readOnly: boolean;
  user?: { name: string; email: string } | null;
  features: { terminal: boolean; portForward: boolean; settingsEdit: boolean };
}

/** Desktop is the default while loading, and when the endpoint is missing (older server). */
const DESKTOP: ServerMode = { mode: "desktop", readOnly: false, features: { terminal: true, portForward: true, settingsEdit: true } };

/** Whether this KubeDeck is the desktop app or a shared web service, and who is signed in. */
export function useServerMode(): ServerMode & { canWrite: boolean } {
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
  return { ...m, canWrite: !m.readOnly };
}
