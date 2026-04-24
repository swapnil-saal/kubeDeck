import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ChevronUp, ChevronDown, X, TerminalSquare, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function getAccentHex(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  if (!raw) return "#ef6c40";
  const [h, s, l] = raw.split(/\s+/).map(parseFloat);
  const toRgb = (h: number, s: number, l: number) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
    return [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  };
  return `#${toRgb(h, s, l)}`;
}

interface TerminalPanelProps {
  context: string;
  namespace: string;
  isOpen: boolean;
  onToggle: () => void;
  height?: number;
}

export function TerminalPanel({ context, namespace, isOpen, onToggle, height = 300 }: TerminalPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [panelHeight, setPanelHeight] = useState(height);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Track context/namespace for reconnection
  const ctxRef = useRef(context);
  const nsRef = useRef(namespace);
  const [ctxMismatch, setCtxMismatch] = useState(false);

  // Detect context/namespace changes
  useEffect(() => {
    if (isOpen && isConnected && (ctxRef.current !== context || nsRef.current !== namespace)) {
      setCtxMismatch(true);
    }
    ctxRef.current = context;
    nsRef.current = namespace;
  }, [context, namespace, isOpen, isConnected]);

  const connectTerminal = useCallback(() => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    if (!termRef.current) return;

    // Create xterm instance
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#04060a",
        foreground: "#c8d3de",
        cursor: getAccentHex(),
        cursorAccent: "#04060a",
        selectionBackground: getAccentHex() + "33",
        selectionForeground: "#ffffff",
        black: "#0a0e14",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit immediately + on resize
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams();
    if (ctxRef.current) params.set("context", ctxRef.current);
    if (nsRef.current && nsRef.current !== "all") params.set("namespace", nsRef.current);
    const wsUrl = `${protocol}//${window.location.host}/api/terminal?${params.toString()}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Send initial resize
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[90m[session ended with code ${msg.code}]\x1b[0m`);
          setIsConnected(false);
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31m[error: ${msg.data}]\x1b[0m`);
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
      term.writeln("\r\n\x1b[31m[connection error]\x1b[0m");
    };

    // Forward key input to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, []);

  // Connect when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay so the DOM is rendered
      const t = setTimeout(() => connectTerminal(), 50);
      return () => clearTimeout(t);
    } else {
      // Disconnect when panel closes
      wsRef.current?.close();
      wsRef.current = null;
      xtermRef.current?.dispose();
      xtermRef.current = null;
      setIsConnected(false);
    }
  }, [isOpen, connectTerminal]);

  // Refit when panel height changes
  useEffect(() => {
    if (isOpen && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      });
    }
  }, [panelHeight, isOpen]);

  // Window resize handler
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && isOpen) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  // Drag resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.max(150, Math.min(window.innerHeight * 0.7, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Refit after resize
      requestAnimationFrame(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelHeight]);

  const handleReconnect = useCallback(() => {
    setCtxMismatch(false);
    connectTerminal();
  }, [connectTerminal]);

  return (
    <>
      {/* Toggle button (visible when terminal is closed) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="fixed bottom-0 right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-t-xl border border-b-0 transition-all text-[11px] font-medium bg-card border-border text-muted-foreground hover:text-primary hover:border-primary/20 shadow-sm"
        >
          <TerminalSquare className="w-4 h-4" />
          <span>Terminal</span>
          <span className="text-muted-foreground/40 text-[9px]">⌃`</span>
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Terminal panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panelHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="relative z-40 border-t border-border bg-surface-inset dark:bg-[#04060a] overflow-hidden flex flex-col"
            style={{ minHeight: 0 }}
          >
            {/* Resize handle */}
            <div
              className="h-1 cursor-ns-resize group flex items-center justify-center hover:bg-primary/10 transition-colors"
              onMouseDown={handleResizeStart}
            >
              <div className="w-12 h-0.5 rounded bg-foreground/[0.08] group-hover:bg-primary/30 transition-colors" />
            </div>

            {/* Terminal header */}
            <div className="flex items-center h-9 px-4 border-b border-border bg-card shrink-0">
              <div className="flex items-center gap-2">
                <TerminalSquare className="w-3.5 h-3.5 text-primary" />
                <span className="text-[11px] font-semibold text-muted-foreground">Shell</span>
                <span className="text-muted-foreground/20">·</span>
                {context && (
                  <span className="text-[11px] font-mono text-emerald-500">{context}</span>
                )}
                {namespace && namespace !== "all" && (
                  <>
                    <span className="text-muted-foreground/30">/</span>
                    <span className="text-[11px] font-mono text-primary">{namespace}</span>
                  </>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                {/* Context mismatch warning */}
                {ctxMismatch && (
                  <button
                    onClick={handleReconnect}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-bold uppercase tracking-wider text-amber-400 hover:bg-amber-500/15 transition-colors"
                    title="Context/namespace changed — click to reconnect"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    ctx changed · reconnect
                  </button>
                )}

                {/* Connection status */}
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                  isConnected ? "text-emerald-400/80" : "text-red-400/60"
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-emerald-400" : "bg-red-400/50"}`} />
                  {isConnected ? "connected" : "disconnected"}
                </div>

                {/* Reconnect */}
                <button
                  onClick={handleReconnect}
                  className="p-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  title="Reconnect (new session)"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>

                {/* Close */}
                <button
                  onClick={onToggle}
                  className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Close terminal"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Terminal container */}
            <div
              ref={termRef}
              className="flex-1 px-1 py-1"
              style={{ minHeight: 0 }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
