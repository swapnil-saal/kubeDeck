import { describe, expect, it } from "vitest";
import { cleanPath, cleanQuery, downloadName, execArgs, explainExecError, parseGrep, parseListing, parseRead, searchable } from "./pod-files";

describe("cleanPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/./src//x/", "/app/src/x"],
    ["/app/../etc", "/etc"],
    ["/../../..", "/"],
    ["/", "/"],
  ])("%j → %j", (raw, want) => expect(cleanPath(raw)).toBe(want));
  it.each(["app", "", "/a\nb", "/a\0b", 42, "/" + "x".repeat(1100)])("rejects %j", (raw) => expect(cleanPath(raw)).toBeNull());
});

describe("cleanQuery", () => {
  it("trims and accepts one line", () => expect(cleanQuery("  TODO ")).toBe("TODO"));
  it.each(["", "   ", "a\nb", "x".repeat(201), 5])("rejects %j", (raw) => expect(cleanQuery(raw)).toBeNull());
});

describe("searchable", () => {
  it.each(["/app", "/etc/nginx", "/home"])("allows %s", (p) => expect(searchable(p)).toBe(true));
  it.each(["/", "/proc", "/proc/1", "/sys/fs", "/dev"])("refuses %s", (p) => expect(searchable(p)).toBe(false));
});

describe("execArgs", () => {
  it("passes the user's values as arguments after a fixed script, never inside it", () => {
    const evil = "/tmp/$(rm -rf /);`id`";
    const args = execArgs({ pod: "api-1", namespace: "e2", context: "e2dev", container: "app" }, "list", [evil]);
    expect(args.slice(0, 8)).toEqual(["exec", "api-1", "-n", "e2", "--context", "e2dev", "-c", "app"]);
    const script = args[args.indexOf("-c", 8) + 1];
    expect(script).not.toContain(evil);
    expect(args.slice(-2)).toEqual(["sh", evil]);
  });
});

describe("parsers", () => {
  it("lists folders first, then files, without . and ..", () => {
    expect(parseListing("b.txt\nsrc/\n.env\n./\n../\nlib/\n")).toEqual({
      entries: [{ name: "lib", dir: true }, { name: "src", dir: true }, { name: ".env", dir: false }, { name: "b.txt", dir: false }],
      truncated: false,
    });
  });
  it("reads size and text, and spots binary files", () => {
    expect(parseRead(Buffer.from("  11\nhello world"))).toEqual({ size: 11, truncated: false, binary: false, text: "hello world" });
    expect(parseRead(Buffer.from("900000\nabc"))).toMatchObject({ size: 900000, truncated: true });
    expect(parseRead(Buffer.concat([Buffer.from("4\n"), Buffer.from([0x7f, 0x45, 0, 0x01])]))).toMatchObject({ binary: true, text: "" });
  });
  it("parses grep -rn output, keeping colons inside the text", () => {
    expect(parseGrep("/app/a.ts:12:const url = 'http://x:80'\nnoise\n")).toEqual([{ path: "/app/a.ts", line: 12, text: "const url = 'http://x:80'" }]);
  });
});

describe("downloadName", () => {
  it("names a file after its last segment and a folder as .tar.gz", () => {
    expect(downloadName("/www/package.json", false)).toBe("package.json");
    expect(downloadName("/www/src", true)).toBe("src.tar.gz");
  });
  it("keeps only safe characters for the header", () => {
    expect(downloadName('/tmp/a b"; x=1.log', false)).toBe("a_b_x_1.log");
  });
});

describe("explainExecError", () => {
  it.each([
    ['Error from server (Forbidden): pods "x" is forbidden: User "u" cannot create resource "pods/exec"', 403],
    ['OCI runtime exec failed: exec failed: unable to start container process: exec: "sh": executable file not found in $PATH', 422],
    ["sh: cd: line 1: can't cd to /nope: No such file or directory", 404],
    ['error: container nope is not valid for pod x', 404],
  ])("%s → %i", (stderr, status) => expect(explainExecError(stderr).status).toBe(status));
});
