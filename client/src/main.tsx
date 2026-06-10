import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// The SPA uses a hash router. If the user landed on a real path like
// `/ai?q=...` (bookmark, address-bar paste, or stale link), bounce it into
// the hash so wouter's hash router can match it. Runs once before render.
(function migratePathToHash() {
  const { pathname, search, hash } = window.location;
  if (pathname !== "/" && !hash) {
    const route = pathname + search;
    history.replaceState(null, "", `/${search}#${route}`);
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
