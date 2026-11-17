/*
 * The docs share KubeDeck's address (it serves them at /docs), so they share its light/dark choice:
 * KubeDeck keeps it in localStorage "kubedeck-theme" (light | dark | system) and copies it into
 * "docmd-theme", which docmd applies before the page draws. Here: follow KubeDeck if they differ,
 * copy a toggle made in the docs back to KubeDeck, and draw KubeDeck's wordmark as the site logo.
 */
(function () {
  var APP_KEY = "kubedeck-theme";
  var DOCS_KEY = "docmd-theme";

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* storage off */ }
  }

  function resolved(mode) {
    if (mode === "light" || mode === "dark") return mode;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (document.body) document.body.setAttribute("data-theme", theme);
    document.querySelectorAll('link[href*="docmd-highlight-light"]').forEach(function (l) { l.disabled = theme === "dark"; });
    document.querySelectorAll('link[href*="docmd-highlight-dark"]').forEach(function (l) { l.disabled = theme === "light"; });
  }

  function followApp() {
    var app = read(APP_KEY);
    if (!app) return;
    write(DOCS_KEY, app === "light" || app === "dark" ? app : null);
    var want = resolved(app);
    if (document.documentElement.getAttribute("data-theme") !== want) apply(want);
  }

  function drawLogo() {
    var link = document.querySelector(".sidebar-header h1 a");
    if (!link || link.querySelector(".kd-logo")) return;
    link.setAttribute("aria-label", "KubeDeck docs");
    link.innerHTML =
      '<span class="kd-logo">' +
      '<span class="kd-wordmark" aria-hidden="true"><span class="kd-kube">kube</span>' +
      '<span class="kd-deck"><span class="kd-d">d<span class="kd-cut"></span></span>eck.</span></span>' +
      '<span class="kd-docs-label">Docs</span></span>';
  }

  // docmd's mermaid plugin draws ```mermaid blocks in the page's light or dark theme and redraws them
  // when the theme changes. The Mermaid it bundles also draws them itself on window load (startOnLoad),
  // usually first: always in the light theme and without keeping the source, so switching themes then
  // fails. Mermaid skips blocks that carry data-processed; the plugin skips only data-processed="true".
  // This script runs before load, so the plugin is the one that draws.
  function leaveDiagramsToPlugin() {
    document.querySelectorAll(".mermaid:not([data-processed])").forEach(function (el) {
      el.setAttribute("data-processed", "pending");
    });
  }

  // the chat answers through KubeDeck (/api/ai/docs): show it only to someone KubeDeck lets use its AI
  function offerChat() {
    if (!window.fetch) return;
    fetch("/api/mode", { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (mode) { if (mode && mode.features && mode.features.ai) document.documentElement.classList.add("kd-ai"); })
      .catch(function () { /* docs served without KubeDeck: no chat */ });
  }

  followApp();
  drawLogo();
  offerChat();
  leaveDiagramsToPlugin();

  // a toggle in the docs becomes KubeDeck's choice too
  document.addEventListener("click", function (e) {
    var target = e.target;
    if (!target || !target.closest || !target.closest(".theme-toggle-button")) return;
    setTimeout(function () {
      var now = document.documentElement.getAttribute("data-theme");
      if (now === "light" || now === "dark") write(APP_KEY, now);
    }, 0);
  });

  // docmd swaps pages without a reload: keep the logo and the theme after each navigation
  new MutationObserver(function () { drawLogo(); }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("storage", function (e) { if (e.key === APP_KEY) followApp(); });
})();
