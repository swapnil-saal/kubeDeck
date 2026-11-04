import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { AnimatePresence, m as motion } from "framer-motion";
import { Lock, MessageSquare, MessageSquarePlus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  deleteAllChats, deleteChat, groupChats, listChats, matchesSearch, onChatsChanged, type ChatSummary,
} from "./chat-store";

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Live list of stored chats; refreshes when one is saved or deleted. */
function useChatList(open: boolean): ChatSummary[] {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => listChats().then((c) => alive && setChats(c)).catch(() => {});
    load();
    const off = onChatsChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [open]);
  return chats;
}

const ChatRow: FC<{
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
}> = ({ chat, active, onOpen }) => {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-2.5 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-foreground">Delete “{chat.title}”?</span>
        <button
          type="button"
          autoFocus
          onClick={() => void deleteChat(chat.id)}
          className="rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground hover:bg-destructive/90"
        >
          Delete
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted">
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className={cn("w-full truncate text-[13px]", active ? "font-semibold text-foreground" : "text-foreground/90")}>
          {chat.title}
        </span>
        <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground">
          {chat.context || "default"} / {chat.namespace || "all"} · {timeLabel(chat.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete chat: ${chat.title}`}
        className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

/** Past conversations, stored only on this device. Slides over the chat from the left. */
export const HistoryDrawer: FC<{
  open: boolean;
  activeId: string;
  onClose: () => void;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
}> = ({ open, activeId, onClose, onOpenChat, onNewChat }) => {
  const chats = useChatList(open);
  const [query, setQuery] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupChats(chats.filter((c) => matchesSearch(c, query))), [chats, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setConfirmAll(false);
      return;
    }
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="absolute inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.aside
            key="drawer"
            role="dialog"
            aria-label="Chat history"
            className="absolute inset-y-0 left-0 z-50 flex w-[20rem] max-w-[88vw] flex-col border-r border-border bg-card"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className="flex-1 text-sm font-semibold text-foreground">Chats</span>
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/40 hover:bg-muted"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                New chat
              </button>
              <button type="button" onClick={onClose} aria-label="Close chat history" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 focus-within:border-primary/50">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Past chats">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-xs text-muted-foreground">
                  <MessageSquare className="h-5 w-5" />
                  {chats.length === 0 ? "No chats yet. Your conversations will appear here." : "No chats match your search."}
                </div>
              ) : (
                groups.map((g) => (
                  <section key={g.label} className="mt-2">
                    <h3 className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{g.label}</h3>
                    <div className="flex flex-col gap-0.5">
                      {g.chats.map((c) => (
                        <ChatRow key={c.id} chat={c} active={c.id === activeId} onOpen={() => onOpenChat(c.id)} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </nav>

            <div className="border-t border-border px-3 py-2.5">
              {confirmAll ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex-1 text-foreground">Delete all {chats.length} chats?</span>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void deleteAllChats().then(() => setConfirmAll(false))}
                    className="rounded-md bg-destructive px-2 py-1 font-semibold text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete all
                  </button>
                  <button type="button" onClick={() => setConfirmAll(false)} className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    Chats are stored only on this device.
                  </span>
                  {chats.length > 0 && (
                    <button type="button" onClick={() => setConfirmAll(true)} className="text-[11px] font-medium text-muted-foreground hover:text-destructive">
                      Delete all
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};
