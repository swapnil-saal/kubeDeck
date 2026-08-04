import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Read/write query params in the hash (`#/path?tab=pods&q=certi`).
 * Params stay on the current path and are cleared when you navigate away
 * (see hash-router: no shared window.location.search).
 */
export function useHashParams() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();

  const params = new URLSearchParams(searchString);

  const get = useCallback(
    (key: string): string | null => {
      const sp = new URLSearchParams(searchString);
      return sp.get(key);
    },
    [searchString],
  );

  const set = useCallback(
    (key: string, value: string | null) => {
      const sp = new URLSearchParams(searchString);
      if (value === null || value === "" || value === undefined) {
        sp.delete(key);
      } else {
        sp.set(key, value);
      }
      const qs = sp.toString();
      const path = location.split("?")[0] || "/";
      setLocation(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [location, searchString, setLocation],
  );

  const setMany = useCallback(
    (updates: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchString);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === undefined) {
          sp.delete(key);
        } else {
          sp.set(key, value);
        }
      }
      const qs = sp.toString();
      const path = location.split("?")[0] || "/";
      setLocation(qs ? `${path}?${qs}` : path, { replace: true });
    },
    [location, searchString, setLocation],
  );

  return { params, get, set, setMany };
}
