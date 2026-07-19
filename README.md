# skillevel

[![npm](https://img.shields.io/npm/v/skillevel.svg)](https://www.npmjs.com/package/skillevel)
[![CI](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml/badge.svg)](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

A test runner and authoring toolchain for **Claude Code skills** — `vitest`,
but a "test" is a prompt and the thing under test is whether a skill
**triggers** (and behaves) the way its author intended. It covers the whole
loop: scaffold a skill (`new`), keep it valid and tidy (`lint`, `fmt`), eval
its triggering (`init`, run), and measure whether it actually improves the
output (`bench`).

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
skillevel --ci               # exit non-zero on any failure or unwritten case
skillevel --json out.json    # also write full results as JSON

skillevel bench sql          # A/B: same prompts with vs without the skill — the lift
skillevel bench sql --min-lift 10   # gate: fail if the lift drops below +10pp

skillevel new my-skill       # scaffold my-skill/SKILL.md (template + guidance)
skillevel lint [skill|path]  # validate SKILL.md files; no target = all under cwd
skillevel fmt --check        # normalize SKILL.md frontmatter (or report drift)
```

## Authoring

Besides running evals, skillevel covers the write side of the loop — offline
and deterministic, like `init`:

- **`new`** scaffolds a skill directory whose `SKILL.md` carries the authoring
  guidance as a comment (the description is the trigger mechanism; keep the
  body under 500 lines; layer extras into `references/`). You write the
  content — it never invents any.
- **`lint`** reports **errors** for what would break the skill (the
  `skill-creator` validation rules: frontmatter shape, kebab-case name,
  description limits) and **warnings** for guidance drift (leftover TODOs and
  placeholders, body over 500 lines, broken `references/` paths, name ≠
  directory).
- **`fmt`** normalizes frontmatter (`name`, `description` first — comments and
  quoting preserved) and trailing whitespace, and touches nothing inside code
  fences or prose.

```bash
$ skillevel new sql          # sql/SKILL.md, ready to fill in
# ...write the skill...
$ skillevel lint

sql/SKILL.md
  error unexpected-key — unexpected frontmatter key(s): triggers (allowed: …)
  warning broken-reference — referenced file does not exist: references/schema.md

1 file · 1 errors · 1 warnings
```

`lint` exits non-zero on errors (warnings alone pass) and `fmt --check` on
unformatted files, so both slot straight into CI next to `skillevel --ci`.

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
  - id: collision-1
    prompt: "Pull the last hour of adnsvc error logs"
    expect_skill: log-query # the sibling must win; sql must stay out
```

Instead of `should_trigger`, a case may declare `expect_skill: <name>` — which
skill should win the routing. Naming the suite's own skill means "triggers";
naming a **sibling** asserts the near-miss lands there (sibling fires, target
stays out); `expect_skill: none` asserts no skill fires at all. This is how
you pin down the #1 failure mode of a growing skill collection: two sibling
skills fighting over the same prompts.

`init` writes example cases as **placeholders** and pulls the skill's own
trigger keywords into a comment — but it does **not** invent cases for you
(auto-generated tests plant plausible-but-wrong checks). You write the real
ones, ideally from real usage traces.

### Expectations

| entry                         | passes when                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `should_trigger`              | the target skill fired (`true`) / did not (`false`)                                                |
| `expect_skill: <name>`        | the named skill fired — and the target stayed out when it names a sibling; `none` = no skill fired |
| `triggered` / `not_triggered` | shorthands validated against `should_trigger`                                                      |
| `match: <re>`                 | the case-insensitive regex appears in the response                                                 |
| `absent: <re>`                | the regex does **not** appear                                                                      |
| `judge: <q>`                  | a fresh Claude (one turn, no skills) grades the response `PASS` against the rubric                 |

A case's score is `passes / trials`; it's green at `>= 0.8` (configurable) so one
flake doesn't fail it. A prompt with an unfilled `<placeholder>` is reported as
**TODO** and fails `--ci`.

## Does it actually help? (`bench`)

Triggering is necessary, not sufficient — a skill also has to **earn its
tokens**. `bench` runs each case's prompt twice, once with the skill available
and once with skills blocked (`--disallowedTools Skill`), grades both outputs
on the case's `match` / `absent` / `judge` expectations, and reports the lift:

```bash
$ skillevel bench sql

sql  ./sql.eval.yaml
  case                    with   without    lift
  aggregate-revenue        3/3       1/3   +67pp
  safe-delete              3/3       3/3     0pp
  neg-concept           — skipped (needs should_trigger: true + match/absent/judge)

▲ skill lift: +34pp   (48% → 82%)   2 benched · 1 skipped   $1.10
```

- **lift ≫ 0** — the skill earns its place.
- **lift ≈ 0 across the board** — retire candidate: the model already does it.
  Keep the cases as a regression guard.
- `--min-lift <pp>` turns the number into a CI gate, so an edit that quietly
  regresses quality fails the build.

Only happy cases (`should_trigger: true`) with output expectations are
benchable — a trigger-only case has nothing to compare. Trials default to 3
per arm (`--trials` to change): every bench case costs two full runs plus a
grader call per `judge`. Both arms run interleaved in the same batch so model
drift hits them equally. Note the baseline blocks _all_ skills, not just the
one under test — fine unless the prompt would have pulled in a sibling.

## How it works

Each case × trial shells out to
`claude -p "<prompt>" --output-format stream-json --verbose`, parses the event
stream (a `Skill` tool_use carries the fired skill in `input.skill`; the
`result` event carries text + `total_cost_usd`), and — for trigger-only cases —
kills the run the moment the verdict is known, to save cost. `bench` adds
`--disallowedTools Skill` for the baseline arm and always runs to completion.

See [DESIGN.md](./DESIGN.md) for the full design and roadmap.

## License

MIT
