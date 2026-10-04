# Dogfood log

Slop-O-Meter builds Slop-O-Meter while Slop-O-Meter watches. Each entry records what we expected,
what the meter said, where it was wrong, and what we changed. Scores here are real outputs, not targets.

## Fixture scenarios (`tests/fixtures/scenarios.ts`)

The same request, "add a search endpoint", implemented several ways, plus the other experiments from
the vision. Scored as clean single-pass turns (no churn). `bun test tests/scenarios.test.ts` prints these;
the tests assert ordering only.

| Scenario | Experiment | Expected | Score |
|---|---|---|---|
| direct: one function, one route | 1 tiny direct change | low | 3 CLEAN |
| normal: a small search module | — | low, above direct | 5 CLEAN |
| overEngineered: interface, repository, factory, service, adapter, builder, config | 2 over-engineering | high | 73 HEAVY SLOP |
| simplification: overEngineered collapsed to direct | 4 simplification | far below 73 | 3 CLEAN |
| largeRefactor: one logger reshaped across 19 files | 3 large legitimate change | not mud | 29 MILD SLOP |
| legacyFix: a one-line fix inside a nested, `any`-typed legacy function | 6 ugly legacy | low | 0 CLEAN |
| untestedRisk / testedRisk: refund rules with and without 4 tests | 7 test effect | tested lower, by a bounded amount | 4 / 0 |
| weakTyping: direct, but `any`, casts, `@ts-ignore` | — | above direct | 23 MILD SLOP |
| needlessDependency: direct, plus lodash and fuse.js | — | above direct | 18 CLEAN |

**Breakdown of overEngineered (73):** abstractions +25 (7 new abstractions, 3 with a single consumer,
7 pattern-named), amplification +25 (≈15 units of machinery for ~4 units of behaviour), surface +11,
comments +7 (doc blocks that only restate class names), type weakening +4 (`as any as string`).

**What we changed along the way**

- *Weighted average → combined evidence.* Under a weighted average the over-engineered version reached
  only 44: abstractions and amplification were both maxed, but quiet metrics diluted them. Metrics now
  combine as independent evidence, `1 − Π(1 − sᵢ)`, split back proportionally so contributions still sum
  to the score. Unavailable metrics simply contribute no evidence.
- *Known soft spot:* largeRefactor (29) is entirely change surface (19 files). Coherent wide changes are
  penalised a little; we will revisit when a real large refactor happens here.
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
