import { describe, expect, it } from "vitest";
import { makeStopPredicate, runSuites } from "../src/core/eval-runner.js";
import type { Suite, TestCase } from "../src/core/types.js";
import { FakeRunner, constantRunner, outcome } from "./helpers.js";

function suite(cases: TestCase[], overrides: Partial<Suite> = {}): Suite {
  return { skill: "sql", cases, ...overrides };
}

describe("runSuites", () => {
  it("scores a case by pass-rate against the threshold", async () => {
    // Fires on 2 of 3 trials → 0.67 pass-rate.
    let call = 0;
    const runner = new FakeRunner(() =>
      outcome({ skillsFired: ++call <= 2 ? ["sql"] : [] }),
    );
    const tc: TestCase = {
      id: "happy",
      prompt: "run sql",
      should_trigger: true,
    };

    const strict = await runSuites([suite([tc])], runner, {
      trials: 3,
      threshold: 0.8,
    });
    expect(strict[0]!.cases[0]).toMatchObject({
      status: "fail",
      passed: 2,
      passRate: 2 / 3,
    });

    call = 0;
    const lenient = await runSuites([suite([tc])], runner, {
      trials: 3,
      threshold: 0.6,
    });
    expect(lenient[0]!.cases[0]!.status).toBe("pass");
  });

  it("marks unwritten placeholder cases todo without running them", async () => {
    const runner = constantRunner(outcome());
    const results = await runSuites(
      [suite([{ id: "todo", prompt: "<fill me>", should_trigger: true }])],
      runner,
    );
    expect(results[0]!.cases[0]!.status).toBe("todo");
    expect(runner.calls).toHaveLength(0);
  });

  it("resolves trials as CLI > case > suite > default", async () => {
    const runner = constantRunner(outcome({ skillsFired: ["sql"] }));
    const cases: TestCase[] = [
      { id: "a", prompt: "p", should_trigger: true, trials: 2 },
      { id: "b", prompt: "p", should_trigger: true },
    ];

    await runSuites([suite(cases, { trials: 4 })], runner);
    // case 'a' runs its own 2, case 'b' inherits the suite's 4
    expect(runner.calls).toHaveLength(6);

    runner.calls.length = 0;
    await runSuites([suite(cases, { trials: 4 })], runner, { trials: 1 });
    expect(runner.calls).toHaveLength(2); // CLI override wins everywhere
  });

  it("caps negative runs at fewer turns than happy runs", async () => {
    const runner = constantRunner(outcome());
    await runSuites(
      [
        suite([
          { id: "happy", prompt: "p", should_trigger: true },
          { id: "neg", prompt: "p", should_trigger: false },
        ]),
      ],
      runner,
      { trials: 1 },
    );
    const [happy, neg] = runner.calls;
    expect(happy!.options.maxTurns).toBeGreaterThan(neg!.options.maxTurns!);
  });

  it("uses the CLI model over the suite's and accumulates cost", async () => {
    const runner = constantRunner(
      outcome({ skillsFired: ["sql"], costUsd: 0.05 }),
    );
    const results = await runSuites(
      [
        suite([{ id: "a", prompt: "p", should_trigger: true }], {
          model: "haiku",
        }),
      ],
      runner,
      { trials: 2, model: "opus" },
    );
    expect(runner.calls[0]!.options.model).toBe("opus");
    expect(results[0]!.cases[0]!.costUsd).toBeCloseTo(0.1);
  });

  it("reports progress per finished trial", async () => {
    const runner = constantRunner(outcome({ skillsFired: ["sql"] }));
    const ticks: Array<[number, number]> = [];
    await runSuites(
      [suite([{ id: "a", prompt: "p", should_trigger: true }])],
      runner,
      { trials: 3, onProgress: (done, total) => ticks.push([done, total]) },
    );
    expect(ticks).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("isolation pins every run to the materialized project", async () => {
    const runner = constantRunner(outcome({ skillsFired: ["sql"] }));
    await runSuites(
      [suite([{ id: "a", prompt: "p", should_trigger: true, cwd: "fixture" }])],
      runner,
      { trials: 2, isolation: { cwd: "/tmp/isolated" } },
    );
    for (const call of runner.calls) {
      expect(call.options.cwd).toBe("/tmp/isolated");
      expect(call.options.isolate).toBe(true);
    }
  });
});

describe("makeStopPredicate", () => {
  const base: TestCase = { id: "c", prompt: "p", should_trigger: true };

  it("expect_skill: none stops on any firing (verdict settled)", () => {
    const stop = makeStopPredicate(
      { ...base, should_trigger: false, expect_skill: "none" },
      "sql",
    );
    expect(stop("anything")).toBe(true);
  });

  it("a sibling firing never stops the run", () => {
    const stop = makeStopPredicate(base, "sql");
    expect(stop("other-skill")).toBe(false);
  });

  it("the target firing stops trigger-only cases, both happy and negative", () => {
    expect(makeStopPredicate(base, "sql")("sql")).toBe(true);
    expect(
      makeStopPredicate({ ...base, should_trigger: false }, "sql")("sql"),
    ).toBe(true);
  });

  it("a happy case with output checks runs to completion", () => {
    const stop = makeStopPredicate(
      { ...base, expect: [{ match: "x" }] },
      "sql",
    );
    expect(stop("sql")).toBe(false);
  });
});
