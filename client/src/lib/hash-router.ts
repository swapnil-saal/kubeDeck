import { useSyncExternalStore } from "react";

/**
 * Hash router for KubeDeck.
 *
 * Wouter's stock useHashLocation stores query params in window.location.search
 * and keeps that search when navigating to a path without ?.... That made
 * dashboard search (?q=) leak into /ai, /settings, etc.
 *
 * Rules:
 * - Path + query live only in the hash: /#/path?tab=pods&q=foo
 * - window.location.search is always cleared on navigate
 * - Path and search are split correctly for wouter's hooks
 */

type NavOpts = { replace?: boolean; state?: unknown };

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    window.addEventListener("hashchange", notify);
    window.addEventListener("popstate", notify);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener("hashchange", notify);
      window.removeEventListener("popstate", notify);
    }
  };
}

function notify() {
  listeners.forEach((cb) => cb());
}

function rawHash(): string {
  let h = window.location.hash.replace(/^#/, "") || "/";
  if (!h.startsWith("/")) h = `/${h}`;
  return h;
}

function currentPath(): string {
  const raw = rawHash();
  const i = raw.indexOf("?");
  return i >= 0 ? raw.slice(0, i) || "/" : raw;
}

function currentSearch(): string {
  const raw = rawHash();
  const i = raw.indexOf("?");
  return i >= 0 ? raw.slice(i + 1) : "";
}

export function migrateSearchIntoHash() {
  const browserSearch = window.location.search.replace(/^\?/, "");
  if (!browserSearch) {
    if (window.location.search) {
      history.replaceState(null, "", `${window.location.pathname}${window.location.hash || "#/"}`);
    }
    return;
  }

  const hash = rawHash();
  const pathOnly = hash.includes("?") ? hash.slice(0, hash.indexOf("?")) : hash;
  const hashQs = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";

  const merged = new URLSearchParams(hashQs);
  const fromBrowser = new URLSearchParams(browserSearch);
  fromBrowser.forEach((v, k) => {
    if (!merged.has(k)) merged.set(k, v);
  });
  const qs = merged.toString();
  const nextHash = qs ? `${pathOnly}?${qs}` : pathOnly;
  history.replaceState(null, "", `${window.location.pathname}#${nextHash}`);
}

export function navigateHash(to: string, opts: NavOpts = {}) {
  let target = to.replace(/^#/, "");
  if (!target.startsWith("/")) target = `/${target}`;

  const url = `${window.location.pathname}#${target}`;
  if (opts.replace) {
    history.replaceState(opts.state ?? null, "", url);
  } else {
    history.pushState(opts.state ?? null, "", url);
  }
  notify();
}

function useAppHashLocationImpl(): [string, (path: string, opts?: NavOpts) => void] {
  const path = useSyncExternalStore(subscribe, currentPath, () => "/");
  return [path, navigateHash];
}

export const useAppHashLocation = Object.assign(useAppHashLocationImpl, {
  hrefs: (href: string) =>
    href.startsWith("#") ? href : `#${href.startsWith("/") ? href : `/${href}`}`,
});

export function useAppHashSearch(): string {
  return useSyncExternalStore(subscribe, currentSearch, () => "");
}
