# Dogfood log

Slop-O-Meter builds Slop-O-Meter while Slop-O-Meter watches. Each entry records what we expected,
what the meter said, where it was wrong, and what we changed. Scores here are real outputs, not targets.

## Live experiments (session 1, branch `dogfood/lab`, since deleted)

Each experiment was one real turn of a Claude Code session with the mod loaded, against a copy of the
shop fixture inside this repository, with nothing else in the turn's diff. "Live" is what the meter
recorded at the time; "now" is the same change scored by the calibrated code (fixtures marked †).

| # | Experiment | Expected | Live | Now |
|---|---|---|---|---|
| 1 | tiny direct `/search` route, with uncommitted user work in the tree | low; user work not attributed | 0 CLEAN; only `routes.ts +4` attributed | 0 |
| 2 | `/items/count` behind interface, repository, service, wrapper, adapter, factory | high | 23* / 70 offline | 75 HEAVY SLOP † |
| 3 | collapse experiment 2 to one line | far below 2 | 23* / 3 offline | 0 † |
| 4 | price formatter written 3 ways, file abandoned, 3 lines kept | small diff, high churn | 15 CLEAN | 27 MILD SLOP † |
| 5 | one-condition fix in a nested, `any`-typed legacy function | low | 0 CLEAN | 0 |
| 6a | refund rules, untested | low | 4 CLEAN | 4 † |
| 6b | the same rules with 4 behavioural tests | below 6a, bounded | 0 CLEAN (tests −8) | 0 † |
| 7 | `log()` → structured `logEvent()` across 19 files | large diff, not mud | 29 MILD SLOP | 8 CLEAN † |

\* Experiments 2 and 3 ran on step-2 code (surface and churn only); see the hot-reload finding below.

**Findings and changes**

- **Hot reload through a symlink never happened.** The session's dev-mods entry was a symlink to this
  repository; the engine never saw edits made through it, so steps 3 and 4 ran only in tests and offline
  until experiment 3. The live setup turn scored 84 BIG BALL OF MUD from surface alone, which only the old
  weighted-average code could produce: that is how we noticed. The dev-mods entry is now a real copy of the
  plugin files, synced from the repository (CONTRIBUTING.md).
- **The lexer ignored every `as` after a top-level `export`** (experiment 2's `as unknown as number` went
  unseen). The module-clause flag now applies only to import/export lists and resets when they close.
- **Deleting files counted as change surface** (experiment 3: six deleted files scored +17). Surface now
  counts only files that gained lines, and deleted lines at a quarter weight.
- **A mechanical rename counted as 19 independent changes** (experiment 7: 29). Files whose edits have the
  same shape (lines removed and added, names and literals erased) now count once: 29 → 8.
- **Churn read too gently** (experiment 4: 97% of the work thrown away and a file abandoned scored 15
  CLEAN). Churn now saturates at 80 wasted lines instead of 200: 15 → 27 MILD SLOP.
- **Tests and tiny changes:** with a 4-point structural score the −8 test modifier clamps to 0, so 6a/6b
  differ by 4. The ordering holds; the modifier shows in the breakdown even when the total is clamped.
- **Correctness is out of scope:** writing 6b's tests showed the `paid === 0 && !isAdmin` rule is
  unreachable. No structural metric can see that, and none should pretend to.

## Does the guard work? (A/B, session 2)

Independent headless sessions (Haiku 4.5), each on a fresh copy of the shop fixture, the mod loaded from this
repository. Three prompts that invite over-engineering the way people actually phrase work, none asking for slop:
discount codes ("production-ready and extensible, following clean architecture"), CSV/JSON export ("easy to add
new formats later"), and rate limiting ("robust and configurable"). Each with `guard: off` and `guard: nudge`,
two runs each.

| Task | off | nudge |
|---|---|---|
| t1 discount codes | 48, 40 | 43, 47 |
| t2 export | 5, 16 | 14, 31 |
| t3 rate limiting | 16, 19 | 19, 17 |
| mean | 24.0 | 28.5 |

**No measurable reduction, and the reason is ours.** In twelve runs the guard spoke four times (one
type-weakening nudge in each t1-nudge run, delivered as a post-tool note); the abstraction nudge never fired.

- **Delivery works.** Nudges arrive beside the tool result; the strict-mode note reaches the next turn
  (verified in one process: asked what it had been told, the agent quoted the note word for word and named its
  own over-engineering). Plugin-appended rows are not saved to headless transcripts, so `claude -p -c` across
  two processes cannot see them; that first test was invalid, not strict mode.
- **When a nudge fires, it lands.** In t1-nudge-1 the agent's edit added `any` to `routes.ts`; its very next
  edit replaced it with a real imported type. Neither nudged run kept `any` in `routes.ts`. Weakening in other
  files went unflagged, because each signal speaks once a turn.
- **The abstraction trigger watches for yesterday's slop.** It waits for three Gang-of-Four names (Service,
  Factory, Adapter…). These agents produced *type sprawl* instead: thirteen exported interfaces for a discount
  feature (`CreateDiscountInput`, `UpdateDiscountResult`, `ValidationResult`…), plus `DiscountValidator` and
  `DiscountCalculator`, names the pattern list lacks. The score caught it (abstractions +13 to +17); the
  nudge did not.
- **A slop the meter cannot see at all: documentation sprawl.** Unrequested `ARCHITECTURE.md`,
  `IMPLEMENTATION_SUMMARY.md`, `QUICKSTART.md`, `DISCOUNTS.md`: up to four new Markdown files in one turn.
  Surface ignores docs and comment noise reads only code, so none of it counts.
- **n = 2 per cell is too small.** Same prompt, same arm: 5 vs 16, 14 vs 31.
- Lab noise: untracked files the harness itself writes (a FIFO, an output log) count as change surface, as
  designed; the in-process strict check scored 43 partly for that reason.

**What we change next:** nudge on new exported types and classes of any name (relative to behaviour), widen
the pattern list, flag type weakening once per file rather than once per turn, add documentation sprawl as a
measured signal with its own nudge, then rerun with at least four runs per cell.

### Round 2: after widening the triggers

Same three prompts and model, four runs per cell (24 runs), with the changes above: the abstraction nudge also
fires at six new types of any name, Validator/Calculator/… join the pattern list, type weakening is flagged per
file, and documentation sprawl is measured and nudged. (Scores are not comparable with round 1: the scoring
gained a component in between. Compare arms within a round.)

| Task | off | nudge | guard spoke? |
|---|---|---|---|
| t1 discount codes | 54, 57, 60, 61 (58.0) | 54, 52, 57, 50 (53.2) | every run: abstractions, docs, types |
| t2 export | 20, 19, 19, 16 (18.5) | 13, 17, 21, 14 (16.2) | never |
| t3 rate limiting | 19, 17, 19, 20 (18.8) | 13, 20, 21, 16 (17.5) | never |

t2 and t3 are the control: the guard never spoke, so both arms ran identically and their gap (1 to 2 points)
is the noise. t1, where it spoke, moved further, and in the components the nudges name:

| t1 | off | nudge |
|---|---|---|
| new Markdown files | 2, 3, 3, 5 | 2, 3, 2, 1 |
| new types and classes | 11, 13, 12, 12 | 12, 6, 8, 11 |
| `any` added | 16, 10, 6, 7 | 0, 0, 0, 16 |

**Reading it honestly:** a modest, consistent improvement where the guard has something to say: about 8% off
the score, a third fewer unrequested documents, a quarter fewer new types, and no `any` in three of four runs.
It is about twice the noise floor, not proof; four runs per cell is still small. Two of the clean-typed runs
were never nudged about types, so not every gain is attributable to the nudge it resembles.

**Why the effect is modest:** the agents plan the structure first and write it file after file; by the sixth
new type most of the design is on disk. Nudges correct the rest of the turn, not the plan. The next experiment
is earlier feedback: a one-line notice at session start that the meter is measuring, and strict mode's
between-turn note, against the same prompts.

## Fixture scenarios (`tests/fixtures/scenarios.ts`)

The same request, "add a search endpoint", implemented several ways, plus the other experiments from
the vision. Scored as clean single-pass turns (no churn). `bun test tests/scenarios.test.ts` prints these;
the tests assert ordering only.

| Scenario | Experiment | Expected | Score |
|---|---|---|---|
| direct: one function, one route | 1 tiny direct change | low | 3 CLEAN |
| normal: a small search module | — | low, above direct | 5 CLEAN |
| overEngineered: interface, repository, factory, service, adapter, builder, config | 2 over-engineering | high | 76 HEAVY SLOP |
| countOverEngineered: live experiment 2 | 2 over-engineering | high | 75 HEAVY SLOP |
| simplification: overEngineered collapsed to direct | 4 simplification | far below 76 | 0 CLEAN |
| churnRewrites: live experiment 4 | 5 churn | small diff, churn shows | 27 MILD SLOP |
| largeRefactor: one logger reshaped across 19 files | 3 large legitimate change | not mud | 8 CLEAN |
| legacyFix: a one-line fix inside a nested, `any`-typed legacy function | 6 ugly legacy | low | 0 CLEAN |
| untestedRisk / testedRisk: refund rules with and without 4 tests | 7 test effect | tested lower, by a bounded amount | 4 / 0 |
| weakTyping: direct, but `any`, casts, `@ts-ignore` | — | above direct | 26 MILD SLOP |
| needlessDependency: direct, plus lodash and fuse.js | — | above direct | 18 CLEAN |

(Scores after the session-1 calibration; the history of each change is below.)

**Breakdown of overEngineered (73):** abstractions +25 (7 new abstractions, 3 with a single consumer,
7 pattern-named), amplification +25 (≈15 units of machinery for ~4 units of behaviour), surface +11,
comments +7 (doc blocks that only restate class names), type weakening +4 (`as any as string`).

**What we changed along the way**

- *Weighted average → combined evidence.* Under a weighted average the over-engineered version reached
  only 44: abstractions and amplification were both maxed, but quiet metrics diluted them. Metrics now
  combine as independent evidence, `1 − Π(1 − sᵢ)`, split back proportionally so contributions still sum
  to the score. Unavailable metrics simply contribute no evidence.
- *Was a soft spot:* largeRefactor scored 29, entirely change surface (19 files). Fixed by grouping
  identical edits (see live experiment 7).
- *Known soft spot:* the test modifier (−8) can take a small risky change to 0. Bounded, as intended,
  but a turn with tests and genuine slop still shows the slop (tests never exceed −8).

## Experiment: first live turn (the gauge, step 3)

- **Task:** build the SVG and terminal gauges.
- **Expected:** low/mild: one coherent feature.
- **Score:** 21 MILD SLOP. Surface +21 (3 production files, 3 directories, 282 lines); churn 0
  (352 edited lines, all survived).
- **Actual outcome:** reasonable. Only two metrics existed then.
- **False positives:** `plugin.json` reformatting counted as changed lines.
- **What we changed:** nothing; noted.

## Experiment 8: Slop-O-Meter itself (step 4, the lexer and metrics)

- **Task:** add the lexer, per-file facts, and the eight remaining metrics.
- **Expected:** mild: a large feature with tests.
- **First score: 64 HEAVY SLOP.**
  ```
  +25  complexity delta: cognitive complexity +355, nesting deepened by 5, 3 functions over 60 lines
  +24  abstraction growth: 16 new abstractions (Kind, Token, lex, Declaration, …), 1 new module
  +11  change surface: 4 production files across 2 directories, 674 lines
  +10  type weakening: +1 `any`, +7 non-null assertions
   -8  test/risk modifier: 25 tests with 42 assertions cover the new logic
  ```
- **False positives found:**
  - The `any` detector counted the object key `any: 0` as a type. Fixed (a key is followed by `:`).
  - Complexity was an absolute delta, so any substantial feature maxed it: the line-count bias the vision
    warns about. Now it judges *density* (complexity per new line) plus structure (nesting past 3 levels,
    functions over 60 lines).
  - Abstraction growth counted exported functions and every type, and counted an `import` as a consumer.
    Now: classes, interfaces, enums, types and modules; consumers are *files*; single consumers and
    pattern names are the smells; growth is judged relative to behaviour added.
  - Doc blocks were penalised by count. Now only doc blocks that merely restate the name beneath them count.
- **After recalibration: 42 GETTING SLOPPY**, and what remained was true:
  `analyze()` (126 lines) and `lex()` (95 lines) were long, nested more than 3 deep, and leaned on 7
  non-null assertions.
- **Believe the meter:** split the lexer into one scanner per token kind and `analyze()` into named passes
  (`walk`, `onWord`, `onPunct`, `readComments`, `shapesOf`); replaced `src[i]!` with `charAt`.
  Same tests, same behaviour.
- **Final: 22 MILD SLOP.** Surface +16 (4 production files, ~690 lines), complexity +12 (dense lexer
  logic, 0.49 per line), duplication +2, tests −8.
