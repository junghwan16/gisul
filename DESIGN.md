# skillevel — design

A test runner for **Claude Code skills**. Think `vitest`, but a "test" is a
prompt and the thing under test is whether a skill fires (and behaves) the way
its author intended.

## Why

Skills are prompt-triggered and non-deterministic. Before shipping or editing
one, two things matter:

1. **Triggering** — does it fire on the prompts it should, and stay out of the
   near-misses it shouldn't (over/under-firing)?
2. (later) **Task quality** — does the skill actually make the output better?

`skillevel` v1 nails **#1**. It's cheap, fast, and the highest-frequency need.
Task-quality A/B grading is v2.

## Positioning

- A **standalone `npx` CLI** — not a Claude Code skill, not tied to one repo.
- It **adopts the community `evals/cases.yaml` schema** (from the `skill-eval`
  skill) rather than inventing one. Cases stay portable; skillevel is just the
  most ergonomic runner + scaffolder for them.
- Mental model: **vitest for skills**. Auto-discovery, `--watch`, reporters,
  `trials` = built-in flake handling, `--ci` = regression gate.

## Commands

```
skillevel                    # discover & run every eval (**/*.eval.yaml, evals/cases.yaml)
skillevel sql                # filter to a skill or a file
skillevel --watch            # re-run on SKILL.md / case changes (inner loop)
skillevel -t "negative"      # filter by case id/substring
skillevel --reporter junit   # grid (default) · dot · json · junit
skillevel --ci               # non-zero exit on any regression / unwritten case
skillevel init sql           # scaffold a cases file from the skill (template + guidance)
```

## Case format (adopted from skill-eval)

```yaml
skill: sql               # leaf name; must match the Skill tool's skill name
trials: 5                # runs per case (variance); per-case override allowed
# model: sonnet          # optional
# triggerThreshold: 0.8  # case is green if pass-rate >= this (default 0.8)
cases:
  - id: happy-1
    prompt: "..."
    should_trigger: true
    expect:              # optional extra asserts, on top of the trigger check
      - triggered
      - match: "SELECT"       # case-insensitive regex in the response
      - absent: "DELETE"      # regex must NOT appear
      # - judge: "is the query read-only and correctly scoped?"  # LLM-graded (v1.1)
  - id: neg-1
    prompt: "..."
    should_trigger: false
    expect: [not_triggered]
```

- `should_trigger` is the **primary check**: did the target skill fire?
- `triggered` / `not_triggered` in `expect` are redundant shorthands (validated
  against `should_trigger`); `match` / `absent` / `judge` add output checks.
- A **placeholder prompt** (contains `<...>`) marks the case as *unwritten* — it
  is reported as TODO and fails `--ci`, so `init` output can't silently pass.

## `init` — scaffold, don't generate

`init` is **offline and deterministic**. It does NOT ask an LLM to invent cases
(auto-generated cases plant plausible-but-wrong tests). It:

1. reads the target `SKILL.md` (dev copy in cwd if present, else installed),
2. pre-fills `skill:` from the frontmatter `name`,
3. writes example happy + near-miss-negative cases as clearly-marked
   placeholders, with the authoring principles inline, and
4. pulls the skill's own **trigger keywords verbatim** into a comment as a hint.

The human writes the real cases — ideally from real usage/production traces.

## Run mechanism

For each case × trial, shell out to:

```
claude -p "<prompt>" --output-format stream-json --verbose [--model M] [--max-turns N]
```

Parse the NDJSON stream: a `tool_use` block named `Skill` carries the fired
skill in `input.skill`; the terminating `result` event carries the final text
and `total_cost_usd`. (Schema verified on Claude Code 2.1.x.)

**Early-exit** (cost saver, borrowed from skill-creator's `run_eval.py`): when a
case has only trigger checks,
- `should_trigger: true` → kill the process the moment the target skill fires
  (fast pass);
- `should_trigger: false` → kill the moment *any* skill fires (fast fail);
otherwise run to completion (needed for `match`/`absent`/`judge`), with a low
`--max-turns` to bound negatives.

## Scoring

- A **trial** passes if the trigger direction matches `should_trigger` and every
  `expect` assert passes.
- A **case**'s score is `passes / trials`; it is green when
  `>= triggerThreshold` (default 0.8), so a single flake doesn't fail it.
- `--ci` exits non-zero if any case is below threshold or unwritten.

## Which version of the skill is tested (v1 limitation)

v1 tests whatever `claude -p` **already discovers** (installed
`~/.claude/skills`, project `.claude/skills`, plugins). To test a working-copy
edit, install/symlink it. **Roadmap:** `--skill-dir <path>` sets up an isolated
temp project (`.claude/skills/<name>` + `--bare`) so you can eval an uncommitted
SKILL.md reproducibly, and skill-on/off ablation for task-quality (v2).

## Non-goals (v1)

- Task-quality A/B grading / lift (v2).
- Multi-harness (Cursor/Codex/Gemini) — v1 is `claude -p` only.
- HTML report — terminal + JSON first.
