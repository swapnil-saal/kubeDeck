import { QueryCache, QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/** A request refused because the session ended (signed out elsewhere, expired, account blocked). */
const SIGNED_OUT = /(^|\D)401(\D|$)|Sign in required/;

export const queryClient: QueryClient = new QueryClient({
  // with KubeDeck's own sign-in, a 401 means the session is gone: ask again who is signed in, which
  // brings back the sign-in page (the proxy and desktop modes never answer 401 to a signed-in page)
  queryCache: new QueryCache({
    onError: (err) => {
      if (SIGNED_OUT.test(err instanceof Error ? err.message : String(err))) void queryClient.invalidateQueries({ queryKey: ["/api/mode"] });
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchOnWindowFocus: true,
      staleTime: 15_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
