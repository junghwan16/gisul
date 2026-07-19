# skillevel

[![npm](https://img.shields.io/npm/v/skillevel.svg)](https://www.npmjs.com/package/skillevel)
[![CI](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml/badge.svg)](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A test runner for **Claude Code skills** — `vitest`, but a "test" is a prompt
and the thing under test is whether a skill **triggers** (and behaves) the way
its author intended.

```bash
$ skillevel sql

sql  ./sql.eval.yaml
  ✓ happy-recent-orders   5/5
  ✓ happy-count-signups   5/5
  ✗ neg-concept           3/5
      ✗ stays out (sql) — fired: sql
  ○ happy-joins           TODO — unwritten

1 failed · 2 passed · 1 todo   $0.28
```

## Why

Skills are prompt-triggered and non-deterministic. Before you ship or edit one,
you want to know it fires on the prompts it should and stays out of the
near-misses it shouldn't. `skillevel` checks exactly that, across repeated
trials, from a YAML file you can write in a minute.

## Install

Requires [Claude Code](https://claude.com/claude-code) on your `PATH` (the
`claude` CLI) and Node ≥ 18.

```bash
npx skillevel@latest init <skill>   # zero-install
npm install -g skillevel            # or install the `skillevel` command
```

From source (there's no build step — it's plain ESM):

```bash
git clone https://github.com/junghwan16/skillevel && cd skillevel
npm install
node src/cli.js <args>              # or `npm link` for a global `skillevel`
```

## Use

```bash
skillevel init sql           # scaffold sql.eval.yaml (template + guidance)
# ...write your cases...
skillevel sql                # run them
skillevel                    # run every *.eval.yaml it can find
skillevel --watch            # re-run on SKILL.md / case edits
skillevel --ci               # exit non-zero on any failure or unwritten case
skillevel -r junit --json out.json
```

## Cases

The format is the community `evals/cases.yaml` schema (from the `skill-eval`
skill), so your cases aren't locked to this tool:

```yaml
skill: sql # leaf name; must match the Skill tool's skill name
trials: 5 # runs per case (variance); per-case override allowed
cases:
  - id: happy-1
    prompt: "Show the 10 most recent orders from the database"
    should_trigger: true
    expect:
      - triggered
      - match: "SELECT" # case-insensitive regex in the response
      - absent: "DELETE" # regex must NOT appear
  - id: neg-1
    prompt: "Refactor this Python function"
    should_trigger: false
    expect: [not_triggered]
```

`init` writes example cases as **placeholders** and pulls the skill's own
trigger keywords into a comment — but it does **not** invent cases for you
(auto-generated tests plant plausible-but-wrong checks). You write the real
ones, ideally from real usage traces.

### Expectations

| entry                         | passes when                                         |
| ----------------------------- | --------------------------------------------------- |
| `should_trigger`              | the target skill fired (`true`) / did not (`false`) |
| `triggered` / `not_triggered` | shorthands validated against `should_trigger`       |
| `match: <re>`                 | the case-insensitive regex appears in the response  |
| `absent: <re>`                | the regex does **not** appear                       |
| `judge: <q>`                  | a fresh Claude grades the response `PASS` _(v1.1)_  |

A case's score is `passes / trials`; it's green at `>= 0.8` (configurable) so one
flake doesn't fail it. A prompt with an unfilled `<placeholder>` is reported as
**TODO** and fails `--ci`.

## How it works

Each case × trial shells out to
`claude -p "<prompt>" --output-format stream-json --verbose`, parses the event
stream (a `Skill` tool_use carries the fired skill in `input.skill`; the
`result` event carries text + `total_cost_usd`), and — for trigger-only cases —
kills the run the moment the verdict is known, to save cost.

## Status

v1 measures **triggering** (over/under-firing). It does not yet measure whether
the skill improves the _output_ — that's the v2 skill-on/off A/B with an
LLM grader. See [DESIGN.md](./DESIGN.md).

## License

MIT
