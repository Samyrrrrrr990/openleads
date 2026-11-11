import { describe, expect, it } from "vitest";

import { applyEvent, type Turn } from "./useAsk";

const turn: Turn = { id: 1, text: "x", status: "running", log: [], found: 0 };

describe("applyEvent", () => {
  it("counts leads as they arrive", () => {
    const t = applyEvent(applyEvent(turn, { type: "lead" }), { type: "lead" });
    expect(t.found).toBe(2);
    expect(applyEvent(t, { type: "progress", count: 14 }).found).toBe(14);
    expect(applyEvent(t, { type: "progress", count: 1 }).found).toBe(2);
  });

  it("keeps only the last few log lines", () => {
    let t = turn;
    for (let i = 0; i < 10; i++) t = applyEvent(t, { type: "phase", message: `step ${i}` });
    expect(t.log).toHaveLength(6);
    expect(t.log[5]).toBe("step 9");
  });

  it("says what a finished step produced and ignores one that only started", () => {
    expect(applyEvent(turn, { type: "node", id: "find", status: "running" })).toBe(turn);
    expect(applyEvent(turn, { type: "node", id: "find", status: "ok", out: { out: 18 } }).log).toEqual([
      "find: done (18)",
    ]);
  });

  it("finishes only on the event that carries a result", () => {
    // the workflow's own done event comes first and has no result
    const inner = applyEvent(turn, { type: "done" });
    expect(inner.status).toBe("running");
    const result = { ok: true, leads: 3, verified: 3, drafts_waiting: 3, sent: 0, workflow: "", message: "" };
    const end = applyEvent(inner, { type: "done", result, answer: "Found 3 leads." });
    expect(end.status).toBe("done");
    expect(end.answer).toBe("Found 3 leads.");
  });

  it("turns an error event into an error", () => {
    expect(applyEvent(turn, { type: "error", message: "That plan is gone." })).toMatchObject({
      status: "error",
      error: "That plan is gone.",
    });
  });
});
