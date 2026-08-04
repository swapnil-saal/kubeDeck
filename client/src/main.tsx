import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { migrateSearchIntoHash } from "./lib/hash-router";

// Single dark scheme only — set before paint
document.documentElement.classList.add("dark");

// Hash-router SPA: real path `/ai?prompt=…` → `/#/ai?prompt=…`
// Also fold any leftover browser `?search` into the hash so it cannot leak.
(function migratePathToHash() {
  const { pathname, search, hash } = window.location;
  if (pathname !== "/" && !hash) {
    const route = pathname + search;
    history.replaceState(null, "", `/#${route.startsWith("/") ? route : `/${route}`}`);
  }
  migrateSearchIntoHash();
})();

createRoot(document.getElementById("root")!).render(<App />);
