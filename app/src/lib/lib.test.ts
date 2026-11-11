import { describe, expect, it } from "vitest";

import { splitLines } from "./api";
import { ago, due, initials, pct, plural, safeUrl } from "./format";
import { parseHash } from "./router";

describe("parseHash", () => {
  it("defaults to today", () => {
    expect(parseHash("").section).toBe("today");
    expect(parseHash("#/").section).toBe("today");
  });
  it("splits sections, decodes addresses and reads the query", () => {
    const r = parseHash("#/people/maya%40northwind.example?tab=notes");
    expect(r.section).toBe("people");
    expect(r.rest).toEqual(["maya@northwind.example"]);
    expect(r.params.get("tab")).toBe("notes");
  });
  it("survives a badly encoded segment", () => {
    expect(parseHash("#/people/%E0%A4%A").rest).toEqual(["%E0%A4%A"]);
  });
});

describe("splitLines", () => {
  it("keeps the unfinished tail for the next chunk", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({ complete: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  });
  it("skips blank lines", () => {
    expect(splitLines("\n\n{}\n").complete).toEqual(["{}"]);
  });
});

describe("format", () => {
  const now = 1_000_000;
  it("says how long ago in the largest sensible unit", () => {
    expect(ago(now - 90, now)).toBe("2m ago");
    expect(ago(now - 7200, now)).toBe("2h ago");
    expect(ago(now - 3 * 86400, now)).toBe("3d ago");
    expect(ago(now + 2 * 86400, now)).toBe("in 2d");
    expect(ago(null, now)).toBe("");
  });
  it("marks overdue dates as late", () => {
    expect(due(now - 3 * 86400, now).late).toBe(true);
    expect(due(null, now)).toEqual({ label: "No date", late: false });
  });
  it("pluralises and formats", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(3, "reply", "replies")).toBe("3 replies");
    expect(pct(4.2)).toBe("4.2%");
    expect(pct(13.6)).toBe("14%");
    expect(pct(50)).toBe("50%");
    expect(pct(0)).toBe("0%");
    expect(initials("Maya Okafor")).toBe("MO");
    expect(initials("", "zed@x.co")).toBe("ZE");
  });
});

describe("safeUrl", () => {
  it("keeps web links", () => {
    expect(safeUrl("https://northwind.example/team")).toBe("https://northwind.example/team");
    expect(safeUrl("http://x.example")).toBe("http://x.example");
  });
  it("adds https to a bare domain", () => {
    expect(safeUrl("northwind.example")).toBe("https://northwind.example");
  });
  it("refuses anything that is not a web link", () => {
    for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "", null, undefined]) {
      expect(safeUrl(bad)).toBe("");
    }
  });
});
