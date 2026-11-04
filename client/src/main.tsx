import { createRoot } from "react-dom/client";
// Fonts ship with the app (no Google Fonts request): works offline in Electron and in a locked-down web mode.
import "@fontsource-variable/outfit/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import App from "./App";
import "./index.css";
import "./themes.css";
import { migrateSearchIntoHash } from "./lib/hash-router";

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
