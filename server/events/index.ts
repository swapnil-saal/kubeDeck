/**
 * KubeDeck's event bus: how a module tells the others that something happened, without calling
 * them. The module that acts emits; the modules that care subscribe (the audit log listens for
 * `action.done`). This file is the module's only front door.
 *
 * `emit` never throws and never waits: handlers run after the caller has moved on, and a handler
 * that fails is logged without stopping the others. Events travel in memory through a transport;
 * a Redis pub/sub transport can replace it (`useTransport`) when several replicas must hear each
 * other's events. A handler that writes shared state (the audit row) then has to make sure only
 * one replica writes it.
 */
import { EventEmitter } from "events";

/** A finished write through KubeDeck's API, with who made it. */
export interface ActionDone {
  at: string;
  userEmail: string;
  userName: string;
  groups: string;
  method: string;
  path: string;
  status: number;
  context: string;
  namespace: string;
  /** the kubectl command, for palette and assistant runs */
  detail: string;
  ip: string;
}

/** An admin changed a KubeDeck account. */
export interface UserChanged {
  userId: string;
  /** the id of the admin who made the change */
  by: string;
  change: "created" | "updated" | "password" | "blocked" | "unblocked" | "signed-out" | "deleted";
}

/** Every event and its payload. Add an event here first. */
/** A plugin was switched on or off, reconfigured, added or removed (Settings → Plugins). */
export interface PluginChanged {
  id: string;
  enabled: boolean;
  /** who did it: an email, or the desktop's user name */
  by: string;
  change: "added" | "enabled" | "disabled" | "settings" | "removed";
}

/** An admin created, changed, deleted or reordered a KubeDeck group (Settings → Groups). */
export interface GroupChanged {
  /** "" when the whole list was reordered */
  id: string;
  change: "created" | "updated" | "deleted" | "reordered";
  by: string;
}

/** An admin added, reconnected or removed a cluster (Settings → Clusters). */
export interface ClusterChanged {
  name: string;
  change: "added" | "updated" | "removed";
  by: string;
}

export interface EventMap {
  "action.done": ActionDone;
  "user.changed": UserChanged;
  "plugin.changed": PluginChanged;
  "group.changed": GroupChanged;
  "cluster.changed": ClusterChanged;
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void | Promise<void>;

/** How events travel between emitters and subscribers: in memory, or (later) across replicas. */
export interface EventTransport {
  /** send an event to every subscriber; may be asynchronous */
  publish(name: EventName, payload: unknown): void;
  /** receive every event published (by this process or, for a shared transport, any other) */
  subscribe(receive: (name: EventName, payload: unknown) => void): () => void;
}

/** The default: this process only. */
export function memoryTransport(): EventTransport {
  const wire = new EventEmitter();
  return {
    publish: (name, payload) => { wire.emit("event", name, payload); },
    subscribe: (receive) => {
      wire.on("event", receive);
      return () => wire.off("event", receive);
    },
  };
}

type AnyHandler = (payload: unknown) => void | Promise<void>;
const handlers = new Map<EventName, Set<AnyHandler>>();
const running = new Set<Promise<void>>();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Run each handler of `name` on its own, after the current call stack. */
function deliver(name: EventName, payload: unknown): void {
  for (const handler of handlers.get(name) ?? []) {
    const run: Promise<void> = Promise.resolve()
      .then(() => handler(payload))
      .then(
        () => undefined,
        (err) => console.error(`[kubedeck] a handler of "${name}" failed: ${message(err)}`),
      )
      .finally(() => running.delete(run));
    running.add(run);
  }
}

let transport = memoryTransport();
let detach = transport.subscribe(deliver);

/** Replace how events travel (e.g. Redis pub/sub). Subscriptions made with `on` are kept. */
export function useTransport(t: EventTransport): void {
  detach();
  transport = t;
  detach = t.subscribe(deliver);
}

/** Tell every subscriber that something happened. Never throws, never waits for a handler. */
export function emit<K extends EventName>(name: K, payload: EventMap[K]): void {
  try {
    transport.publish(name, payload);
  } catch (err) {
    console.error(`[kubedeck] could not emit "${name}": ${message(err)}`);
  }
}

/** Call `handler` for every `name` event. Returns the function that stops it. */
export function on<K extends EventName>(name: K, handler: EventHandler<K>): () => void {
  const set = handlers.get(name) ?? new Set<AnyHandler>();
  handlers.set(name, set);
  const h = handler as AnyHandler;
  set.add(h);
  return () => { set.delete(h); };
}

/** Resolves once every handler started so far has finished (for shutdown and tests). */
export async function settled(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running]);
}
