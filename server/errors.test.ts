import { describe, expect, it } from "vitest";
import { isUnreachableMessage, reportUnreachableAs503 } from "./errors";

function fakeRes(status = 500) {
  const sent: { status: number; body?: any } = { status };
  const res: any = {
    statusCode: status,
    status(code: number) { this.statusCode = code; sent.status = code; return this; },
    json(body: unknown) { sent.body = body; return this; },
  };
  return { res, sent };
}

describe("isUnreachableMessage", () => {
  it.each([
    "Error: Unable to connect to the server: context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
    "dial tcp 10.0.0.1:6443: i/o timeout",
    "The connection to the server was refused - connection refused",
    "no route to host",
    "net/http: TLS handshake timeout",
  ])("recognises: %s", (m) => expect(isUnreachableMessage(m)).toBe(true));
  it.each(["pods \"x\" not found", "Error from server (Forbidden): ...", "Failed to parse kubectl output", undefined, 42])(
    "ignores: %s", (m) => expect(isUnreachableMessage(m)).toBe(false),
  );
});

describe("reportUnreachableAs503", () => {
  it("turns a connectivity 500 into a plain 503", () => {
    const { res, sent } = fakeRes(500);
    reportUnreachableAs503({} as any, res, () => {});
    res.json({ message: "Error: Unable to connect to the server: context deadline exceeded" });
    expect(sent.status).toBe(503);
    expect(sent.body.code).toBe("unreachable");
    expect(sent.body.message).toMatch(/VPN or network/);
  });
  it("leaves other errors and successes alone", () => {
    const a = fakeRes(500);
    reportUnreachableAs503({} as any, a.res, () => {});
    a.res.json({ message: "pods not found" });
    expect(a.sent.status).toBe(500);
    expect(a.sent.body.message).toBe("pods not found");

    const b = fakeRes(200);
    reportUnreachableAs503({} as any, b.res, () => {});
    b.res.json([{ name: "x" }]);
    expect(b.sent.status).toBe(200);
  });
});
