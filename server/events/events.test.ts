import { afterEach, describe, expect, it, vi } from "vitest";
import { emit, memoryTransport, on, settled, useTransport, type EventName, type UserChanged } from "./index";

const change = (userId: string): UserChanged => ({ userId, by: "admin-1", change: "updated" });

describe("event bus", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.restoreAllMocks();
    useTransport(memoryTransport());
  });

  it("delivers an event to every handler of its name, after the emitter has returned", async () => {
    const seen: string[] = [];
    stops.push(on("user.changed", (e) => { seen.push(`a:${e.userId}`); }));
    stops.push(on("user.changed", async (e) => { seen.push(`b:${e.userId}`); }));
    stops.push(on("action.done", () => { seen.push("other event"); }));
    emit("user.changed", change("u1"));
    expect(seen).toEqual([]);
    await settled();
    expect(seen).toEqual(["a:u1", "b:u1"]);
  });

  it("stops calling a handler once unsubscribed", async () => {
    const seen: string[] = [];
    const stop = on("user.changed", (e) => { seen.push(e.userId); });
    emit("user.changed", change("u1"));
    await settled();
    stop();
    emit("user.changed", change("u2"));
    await settled();
    expect(seen).toEqual(["u1"]);
  });

  it("keeps a failing handler from affecting the emitter or the other handlers", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    stops.push(on("user.changed", () => { throw new Error("boom"); }));
    stops.push(on("user.changed", async () => { throw new Error("async boom"); }));
    stops.push(on("user.changed", (e) => { seen.push(e.userId); }));
    expect(() => emit("user.changed", change("u1"))).not.toThrow();
    await settled();
    expect(seen).toEqual(["u1"]);
    expect(errors.mock.calls.map((c) => String(c[0]))).toEqual([
      '[kubedeck] a handler of "user.changed" failed: boom',
      '[kubedeck] a handler of "user.changed" failed: async boom',
    ]);
  });

  it("travels through a replaceable transport, and a broken one never throws at the emitter", async () => {
    const published: EventName[] = [];
    const inner = memoryTransport();
    useTransport({ publish: (name, payload) => { published.push(name); inner.publish(name, payload); }, subscribe: inner.subscribe });
    const seen: string[] = [];
    stops.push(on("user.changed", (e) => { seen.push(e.userId); }));
    emit("user.changed", change("u1"));
    await settled();
    expect(published).toEqual(["user.changed"]);
    expect(seen).toEqual(["u1"]);

    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useTransport({ publish: () => { throw new Error("down"); }, subscribe: () => () => undefined });
    expect(() => emit("user.changed", change("u2"))).not.toThrow();
    expect(String(errors.mock.calls[0]?.[0])).toMatch(/could not emit "user.changed": down/);
  });
});
