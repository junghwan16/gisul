# skillevel

[![npm](https://img.shields.io/npm/v/skillevel.svg)](https://www.npmjs.com/package/skillevel)
[![CI](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml/badge.svg)](https://github.com/junghwan16/skillevel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A test runner for Claude Code skills.** Think `vitest`, but a "test" is a
prompt, and the thing under test is your skill's behaviour:

- **Does it trigger?** — fires on the prompts it should, stays out of the
  near-misses it shouldn't. Skills are prompt-triggered and non-deterministic;
  this is the #1 thing that breaks when you write or edit one.
- **Does it help?** — the same prompt answered better _with_ the skill than
  without. If not, the skill isn't earning its tokens.

You describe both in a small YAML file; `skillevel` runs each case repeatedly
through `claude -p`, scores the pass-rate, and prints a familiar test report:

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

It also covers the write side of the loop: `new` scaffolds a `SKILL.md`,
`lint` and `fmt` keep it valid and tidy — all offline and deterministic.

## Quick start

Requires [Claude Code](https://claude.com/claude-code) on your `PATH` (the
`claude` CLI, logged in) and Node ≥ 18. No install needed — `npx` works, or
`npm i -g skillevel` for a global command.

**1. Scaffold with one command:**

```bash
npx skillevel@latest new sql
```

`new` creates whatever the skill is missing and skips what's already there:
if no skill named `sql` exists (locally or installed), it scaffolds
`sql/SKILL.md`; either way it scaffolds `sql.eval.yaml`, reading the skill's
own `SKILL.md` and quoting its trigger keywords into a comment. It leaves
clearly-marked placeholders — it never invents cases for you (auto-generated
tests plant plausible-but-wrong checks).

**2. Replace the placeholders with real prompts** — things you (or your
users) actually typed. Aim for ~5 that should fire and ~5 near-misses that
must not:

```yaml
skill: sql
trials: 5

cases:
  - id: happy-recent-orders
    prompt: "Show the 10 most recent orders from the database"
    should_trigger: true
    expect:
      - match: "SELECT" # and the answer should contain SQL

  - id: neg-concept # adjacent topic — must NOT fire
    prompt: "What's the difference between an inner and outer join?"
    should_trigger: false
```

**3. Run it:**

```bash
npx skillevel sql
```

Red cases tell you exactly how the skill misfired (`fired: <skill>`); edit
the skill's `description`, run again, repeat until green. When it triggers
right, measure whether it actually improves answers:

```bash
npx skillevel bench sql
```

## Commands

| command                     | what it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `skillevel [target]`        | run eval suites — all discovered, or one skill / file                  |
| `skillevel bench [target]`  | A/B each case with vs without the skill; report the lift               |
| `skillevel new <skill>`     | scaffold what's missing: `<skill>/SKILL.md` and/or `<skill>.eval.yaml` |
| `skillevel lint [targets…]` | validate `SKILL.md` files (packaging errors + guidance warnings)       |
| `skillevel fmt [targets…]`  | normalize `SKILL.md` frontmatter/whitespace (`--check` to only report) |

Useful flags on runs: `-t <substr>` filters cases by id, `-m <model>`
overrides the model, `-c <n>` sets parallelism, `--json <file>` writes full
machine-readable results, `--ci` makes failures and unwritten cases exit
non-zero, and `bench --min-lift <pp>` fails when the lift drops too low.

Suites are discovered automatically: any `*.eval.yaml` (or `evals/cases.yaml`)
under the current directory.

## Writing cases

The format is the community `evals/cases.yaml` schema (from the `skill-eval`
skill), so your cases aren't locked to this tool.

Every case is a `prompt` plus a trigger expectation — either
`should_trigger: true|false`, or the routing form `expect_skill`:

```yaml
- id: collision-1
  prompt: "Pull the last hour of adnsvc error logs"
  expect_skill: log-query # the sibling must win; this suite's skill must stay out
```

`expect_skill: <sibling>` pins down the #1 failure mode of a growing skill
collection — two skills fighting over the same prompts. `expect_skill: none`
asserts no skill fires at all.

`expect` adds optional checks on the response itself:

| entry                         | passes when                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `triggered` / `not_triggered` | shorthands validated against `should_trigger`                                      |
| `match: <re>`                 | the case-insensitive regex appears in the response                                 |
| `absent: <re>`                | the regex does **not** appear                                                      |
| `judge: <q>`                  | a fresh Claude (one turn, no skills) grades the response `PASS` against the rubric |

Tips that make suites worth having:

- **Negatives are the point.** Near-misses ("adjacent but must NOT fire")
  catch over-triggering; obviously unrelated prompts catch nothing.
- **Paste real usage.** Production traces and prompts you actually typed beat
  anything invented.
- **Flakes don't fail you.** A case's score is `passes / trials`, green at
  ≥ 0.8 (`--threshold` to change) — one bad trial out of five still passes.
- **TODO is loud.** A prompt still containing a `<placeholder>` reports as
  TODO and fails `--ci`, so scaffolded suites can't silently pass.

## Does the skill actually help? (`bench`)

Triggering is necessary, not sufficient. `bench` runs each case's prompt
twice — once with the skill available, once with skills blocked
(`--disallowedTools Skill`) — grades both outputs on the case's
`match` / `absent` / `judge` expectations, and reports the lift:

```bash
$ skillevel bench sql

sql  ./sql.eval.yaml
  case                    with   without    lift
  aggregate-revenue        3/3       1/3   +67pp
  safe-delete              3/3       3/3     0pp
  neg-concept           — skipped (needs should_trigger: true + match/absent/judge)

▲ skill lift: +34pp   (48% → 82%)   2 benched · 1 skipped   $1.10
```

How to read it:

- **lift ≫ 0** — the skill earns its place.
- **lift ≈ 0 across the board** — retire candidate: the model already does
  this without help. Keep the cases as a regression guard.
- **a case at 0pp** — the model handles that prompt fine on its own; the
  skill's value lives in the other cases.

Only happy cases (`should_trigger: true`) with output expectations are
benchable — a trigger-only case has nothing to compare. Trials default to 3
per arm (`--trials`) since every bench case costs two full runs plus a grader
call per `judge`. Both arms run interleaved in the same batch so model drift
hits them equally. Caveat: the baseline blocks _all_ skills, not just the one
under test — fine unless the prompt would have pulled in a sibling.

## Authoring `SKILL.md`

- **`new`** scaffolds a skill directory whose `SKILL.md` carries the
  authoring guidance as a deletable comment (the description is the trigger
  mechanism; keep the body under 500 lines; layer extras into `references/`) —
  plus the eval file, in one go. Anything that already exists is skipped, so
  it's safe to run on an existing skill just to get its cases file.
- **`lint`** reports **errors** for what would break the skill (frontmatter
  shape, kebab-case name, description limits — the `skill-creator` validation
  rules) and **warnings** for guidance drift (leftover TODOs/placeholders,
  body over 500 lines, broken `references/` paths, name ≠ directory).
- **`fmt`** normalizes frontmatter (`name`, `description` first — comments
  and quoting preserved) and trailing whitespace, touching nothing inside
  code fences. When it can't parse a file it leaves it alone.

```bash
$ skillevel lint

sql/SKILL.md
  error unexpected-key — unexpected frontmatter key(s): triggers (allowed: …)
  warning broken-reference — referenced file does not exist: references/schema.md

1 file · 1 errors · 1 warnings
```

`lint` exits non-zero on errors (warnings alone pass); `fmt --check` on
unformatted files.

## CI

The authoring checks are offline; the eval/bench runs need the `claude` CLI
and an API key. A typical GitHub Actions split:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }

# offline — every push
- run: npx skillevel@latest lint && npx skillevel@latest fmt --check

# paid — e.g. only when skills/ or *.eval.yaml changed
- run: npm install -g @anthropic-ai/claude-code
- run: npx skillevel@latest --ci
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
- run: npx skillevel@latest bench --min-lift 10
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Cost stays modest because trigger-only cases exit the moment the verdict is
known — the summary line prints what each run actually cost.

## Good to know

- **What's under test is the _installed_ skill** — whatever `claude -p`
  discovers (`~/.claude/skills`, the project's `.claude/skills`, plugins). To
  eval a working-copy edit, symlink or install it first. Isolated
  `--skill-dir` runs are on the roadmap ([DESIGN.md](./DESIGN.md)).
- **There is deliberately no `--watch`** — every run costs real money and
  minutes; re-running is a decision, not a save-hook.
- **`skill:` must match the Skill tool's name** — the leaf name Claude Code
  shows, not a path.

## License

MIT
