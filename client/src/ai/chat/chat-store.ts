import type { UIMessage } from "ai";

/**
 * Ask Deck conversations, kept in this browser / desktop app only (IndexedDB) until the
 * user deletes them. Nothing is sent anywhere. Summaries and messages are stored apart,
 * so the history list never loads tool output it does not show.
 */

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** scope the chat last ran in */
  context: string;
  namespace: string;
  mode: string;
  messageCount: number;
}

export interface StoredChat extends ChatSummary {
  messages: UIMessage[];
}

const DB_NAME = "kubedeck-chats";
const DB_VERSION = 1;
const SUMMARIES = "summaries";
const MESSAGES = "messages";
const ACTIVE_KEY = "kubedeck.ai.activeChat";
const CHANGED_EVENT = "kubedeck:chats-changed";

// ── pure helpers (unit-tested) ─────────────────────────────

export function newChatId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The first thing the user asked, on one line. */
export function chatTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
    if (text) return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  }
  return "New chat";
}

export type ChatGroup = { label: string; chats: ChatSummary[] };

/** Newest first, grouped as Today / Yesterday / Previous 7 days / Older. */
export function groupChats(chats: ChatSummary[], now = Date.now()): ChatGroup[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const day = 86_400_000;
  const buckets: ChatGroup[] = [
    { label: "Today", chats: [] },
    { label: "Yesterday", chats: [] },
    { label: "Previous 7 days", chats: [] },
    { label: "Older", chats: [] },
  ];
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const i = c.updatedAt >= today ? 0 : c.updatedAt >= today - day ? 1 : c.updatedAt >= today - 7 * day ? 2 : 3;
    buckets[i].chats.push(c);
  }
  return buckets.filter((b) => b.chats.length > 0);
}

export function matchesSearch(chat: ChatSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [chat.title, chat.context, chat.namespace].some((s) => s.toLowerCase().includes(q));
}

export const EXPIRED_APPROVAL_REASON = "Expired: this approval was not answered before the chat was closed. Ask again to run it.";

/**
 * Approvals are signed per server process, so one left pending in a stored chat can never
 * be answered. Show it as expired (denied) instead of offering buttons that cannot work.
 */
export function expirePendingApprovals(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    let changed = false;
    const parts = m.parts.map((p) => {
      const part = p as { state?: string; approval?: { id: string } };
      if (part.state !== "approval-requested" || !part.approval) return p;
      changed = true;
      return { ...p, state: "output-denied", approval: { id: part.approval.id, approved: false, reason: EXPIRED_APPROVAL_REASON } } as typeof p;
    });
    return changed ? { ...m, parts } : m;
  });
}

// ── IndexedDB ─────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function announce(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Calls `listener` whenever any chat is saved or deleted (in this tab). */
export function onChatsChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, listener);
  return () => window.removeEventListener(CHANGED_EVENT, listener);
}

export async function listChats(): Promise<ChatSummary[]> {
  const db = await openDb();
  const all = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<ChatSummary[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadChat(id: string): Promise<StoredChat | null> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, MESSAGES]);
  const [summary, body] = await Promise.all([
    result(tx.objectStore(SUMMARIES).get(id) as IDBRequest<ChatSummary | undefined>),
    result(tx.objectStore(MESSAGES).get(id) as IDBRequest<{ id: string; messages: UIMessage[] } | undefined>),
  ]);
  if (!summary || !body) return null;
  return { ...summary, messages: expirePendingApprovals(body.messages) };
}

/** Save a chat after a turn. An empty conversation is not stored. */
export async function saveChat(chat: Omit<StoredChat, "title" | "messageCount" | "createdAt"> & { createdAt?: number }): Promise<void> {
  if (chat.messages.length === 0) return;
  const db = await openDb();
  // read first in its own transaction: a write transaction must not wait on a promise
  const existing = await result(db.transaction(SUMMARIES).objectStore(SUMMARIES).get(chat.id) as IDBRequest<ChatSummary | undefined>);
  const summary: ChatSummary = {
    id: chat.id,
    title: chatTitle(chat.messages),
    createdAt: existing?.createdAt ?? chat.createdAt ?? Date.now(),
    updatedAt: chat.updatedAt,
    context: chat.context,
    namespace: chat.namespace,
    mode: chat.mode,
    messageCount: chat.messages.length,
  };
  const tx = db.transaction([SUMMARIES, MESSAGES], "readwrite");
  tx.objectStore(SUMMARIES).put(summary);
  // a JSON round trip keeps only plain data, which is all IndexedDB can store
  tx.objectStore(MESSAGES).put({ id: chat.id, messages: JSON.parse(JSON.stringify(chat.messages)) });
  await done(tx);
  announce();
}

export async function deleteChat(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, MESSAGES], "readwrite");
  tx.objectStore(SUMMARIES).delete(id);
  tx.objectStore(MESSAGES).delete(id);
  await done(tx);
  if (getActiveChatId() === id) setActiveChatId(null);
  announce();
}

export async function deleteAllChats(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SUMMARIES, MESSAGES], "readwrite");
  tx.objectStore(SUMMARIES).clear();
  tx.objectStore(MESSAGES).clear();
  await done(tx);
  setActiveChatId(null);
  announce();
}

// ── which chat is open (survives reloads) ─────────────────

export function getActiveChatId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveChatId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // storage blocked: the chat still works, it just is not reopened after a reload
  }
}
