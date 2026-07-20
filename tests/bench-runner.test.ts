import { describe, expect, it } from "vitest";
import { benchSuites } from "../src/core/bench-runner.js";
import { summarizeBench } from "../src/core/summary.js";
import type { Suite, TestCase } from "../src/core/types.js";
import { FakeRunner, outcome } from "./helpers.js";

const benchable: TestCase = {
  id: "happy",
  prompt: "write sql",
  should_trigger: true,
  expect: [{ match: "SELECT" }],
};

function suite(cases: TestCase[]): Suite {
  return { skill: "sql", cases };
}

/** With the skill: good output. Without: bad output. */
const skillHelpsRunner = () =>
  new FakeRunner((_prompt, options) =>
    outcome({
      text: options.disallowSkills ? "no idea" : "SELECT * FROM t",
      costUsd: 0.01,
    }),
  );

describe("benchSuites", () => {
  it("runs both arms per trial and scores them separately", async () => {
    const runner = skillHelpsRunner();
    const results = await benchSuites([suite([benchable])], runner, {
      trials: 3,
    });
    expect(results[0]!.cases[0]).toMatchObject({
      status: "done",
      trials: 3,
      withPassed: 3,
      withoutPassed: 0,
    });
    expect(runner.calls).toHaveLength(6); // 3 trials × 2 arms
    expect(runner.calls.filter((c) => c.options.disallowSkills).length).toBe(3);
  });

  it("skips negative and trigger-only cases, marks placeholders todo", async () => {
    const runner = skillHelpsRunner();
    const results = await benchSuites(
      [
        suite([
          benchable,
          {
            id: "neg",
            prompt: "p",
            should_trigger: false,
            expect: [{ match: "x" }],
          },
          { id: "trigger-only", prompt: "p", should_trigger: true },
          { id: "todo", prompt: "<unwritten>", should_trigger: true },
        ]),
      ],
      runner,
      { trials: 1 },
    );
    expect(results[0]!.cases.map((c) => c.status)).toEqual([
      "done",
      "skipped",
      "skipped",
      "todo",
    ]);
  });

  it("isolation swaps the arm cwds instead of blocking the Skill tool", async () => {
    // The skill only "exists" in the with-arm project.
    const runner = new FakeRunner((_prompt, options) =>
      outcome({
        text: options.cwd === "/proj/with" ? "SELECT * FROM t" : "no idea",
      }),
    );
    const results = await benchSuites([suite([benchable])], runner, {
      trials: 2,
      isolation: (skill) => {
        expect(skill).toBe("sql");
        return { withCwd: "/proj/with", withoutCwd: "/proj/without" };
      },
    });
    expect(results[0]!.cases[0]).toMatchObject({
      withPassed: 2,
      withoutPassed: 0,
    });
    const cwds = runner.calls.map((c) => c.options.cwd).sort();
    expect(cwds).toEqual([
      "/proj/with",
      "/proj/with",
      "/proj/without",
      "/proj/without",
    ]);
    for (const call of runner.calls) {
      expect(call.options.disallowSkills).toBeUndefined();
      expect(call.options.isolate).toBe(true);
    }
  });

  it("accumulates cost across both arms", async () => {
    const results = await benchSuites(
      [suite([benchable])],
      skillHelpsRunner(),
      {
        trials: 2,
      },
    );
    expect(results[0]!.cases[0]!.costUsd).toBeCloseTo(0.04);
  });
});

describe("summarizeBench", () => {
  it("computes rates and lift in percentage points across benched cases", async () => {
    const results = await benchSuites(
      [suite([benchable])],
      skillHelpsRunner(),
      {
        trials: 4,
      },
    );
    const summary = summarizeBench(results);
    expect(summary).toMatchObject({
      benched: 1,
      skipped: 0,
      todo: 0,
      withRate: 1,
      withoutRate: 0,
      liftPp: 100,
    });
  });

  it("reports zero rates when nothing was benched", () => {
    const summary = summarizeBench([
      {
        skill: "sql",
        file: "f",
        cases: [
          {
            id: "neg",
            status: "skipped",
            trials: 0,
            withPassed: 0,
            withoutPassed: 0,
            costUsd: 0,
          },
        ],
      },
    ]);
    expect(summary).toMatchObject({ benched: 0, skipped: 1, liftPp: 0 });
  });
});
