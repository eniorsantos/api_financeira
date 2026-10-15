import { describe, expect, it, vi } from "vitest";
import { startScheduler } from "./scheduler.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scheduler", () => {
  it("roda a tarefa no intervalo e para com stop()", async () => {
    const task = vi.fn().mockResolvedValue(undefined);
    const errors: unknown[] = [];
    const h = startScheduler(task, 20, (e) => errors.push(e));
    await sleep(75);
    const n = task.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(2); // imediata + ≥1 intervalo
    h.stop();
    await sleep(50);
    expect(task.mock.calls.length).toBe(n);
    expect(errors).toEqual([]);
  });

  it("não sobrepõe rodadas e reporta erro sem quebrar", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const h = startScheduler(
      async () => {
        calls++;
        await sleep(40);
        if (calls === 1) throw new Error("boom");
      },
      10,
      (e) => errors.push(e),
    );
    await sleep(100);
    h.stop();
    expect(errors.map(String)).toEqual(["Error: boom"]);
    expect(calls).toBeLessThanOrEqual(4); // sem sobreposição
  });
});
