import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { chatTitle, expirePendingApprovals, EXPIRED_APPROVAL_REASON, groupChats, matchesSearch, newChatId, type ChatSummary } from "./chat-store";

const user = (text: string): UIMessage => ({ id: Math.random().toString(36), role: "user", parts: [{ type: "text", text }] });

const summary = (id: string, updatedAt: number, extra: Partial<ChatSummary> = {}): ChatSummary => ({
  id, title: id, createdAt: updatedAt, updatedAt, context: "e2dev", namespace: "e2", mode: "chat", messageCount: 2, ...extra,
});

describe("chatTitle", () => {
  it("uses the first user message on one line", () => {
    expect(chatTitle([user("  why is\n e2-api   crashing? "), user("second")])).toBe("why is e2-api crashing?");
  });
  it("shortens long questions", () => {
    const title = chatTitle([user("x".repeat(200))]);
    expect(title).toHaveLength(78);
    expect(title.endsWith("…")).toBe(true);
  });
  it("falls back when there is no user text", () => expect(chatTitle([])).toBe("New chat"));
});

describe("groupChats", () => {
  const now = new Date("2026-11-04T15:00:00").getTime();
  const hour = 3_600_000;
  it("groups newest first by day", () => {
    const groups = groupChats(
      [
        summary("old", now - 40 * 24 * hour),
        summary("today-early", now - 5 * hour),
        summary("yesterday", now - 20 * hour),
        summary("today-late", now - hour),
        summary("last-week", now - 4 * 24 * hour),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ["Today", ["today-late", "today-early"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["last-week"]],
      ["Older", ["old"]],
    ]);
  });
  it("leaves out empty groups", () => expect(groupChats([], now)).toEqual([]));
});

describe("matchesSearch", () => {
  const chat = summary("c", 1, { title: "Why is e2-api crashing?", context: "e2dev", namespace: "payments" });
  it.each(["", "CRASH", "payments", "e2dev"])("matches %j", (q) => expect(matchesSearch(chat, q)).toBe(true));
  it("does not match other text", () => expect(matchesSearch(chat, "ingress")).toBe(false));
});

describe("expirePendingApprovals", () => {
  const pending = {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text: "Scaling it." },
      { type: "tool-kubectl", toolCallId: "t1", state: "approval-requested", input: { command: "scale deploy x --replicas=2" }, approval: { id: "ap1", signature: "s" } },
      { type: "tool-k8s_list", toolCallId: "t0", state: "output-available", input: { resource: "pods" }, output: "ok" },
    ],
  } as unknown as UIMessage;

  it("turns an unanswered approval into an expired denial", () => {
    const [m] = expirePendingApprovals([pending]);
    const part = m.parts[1] as unknown as { state: string; approval: { id: string; approved: boolean; reason: string } };
    expect(part.state).toBe("output-denied");
    expect(part.approval).toEqual({ id: "ap1", approved: false, reason: EXPIRED_APPROVAL_REASON });
  });
  it("leaves finished calls and other messages untouched", () => {
    const question = user("hi");
    const [m, q] = expirePendingApprovals([pending, question]);
    expect(m.parts[2]).toBe(pending.parts[2]);
    expect(q).toBe(question);
  });
});

describe("newChatId", () => {
  it("is unique", () => expect(new Set(Array.from({ length: 50 }, newChatId)).size).toBe(50));
});
