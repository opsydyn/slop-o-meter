this is the one i’d paste into a fresh claude code session in the new repo. it tells claude to **build**, not just discuss, and keeps the public git repo canonical from the start.

# slop-o-meter — complete build handoff

build an open-source Claude Code mod/plugin called **Slop-O-Meter**.

this is an implementation task, not a design exercise.

work through the project until we have a usable, tested, dogfooded MVP.

do not stop after scaffolding or produce only a plan.

---

# 0. context

Slop-O-Meter measures whether an AI coding agent is making a codebase needlessly harder to understand, maintain, test, or change.

the presentation should be fun.

the measurement must be serious.

the core output is a **0–100 Slop Score** based primarily on deterministic metrics gathered from:

- the git diff
- code structure
- tool/edit activity during the turn
- repository context
- before/after measurements

this must **not** be an LLM vibe score.

the distinctive idea is that Claude Code can measure not only the final code, but also how the agent got there.

that gives us signals normal static-analysis tools do not have, especially:

- agent churn
- change amplification
- abandoned work
- repeated rewrites
- request-to-implementation ratio

---

# 1. first instruction: use the current repository

this git repository is the canonical source of truth from the first commit.

do not create the real project only under:

```text
~/.claude/dev-mods/
```

use the built-in `plugin-authoring` skill to understand the current Claude Code mod APIs, supported events, UI elements, generated types, testing APIs, and loading behaviour.

if Claude Code requires a session-specific dev-mod copy for hot reload, treat that only as a development mirror.

the checked-out git repository remains canonical.

all real source, tests, docs and release metadata belong here.

the final repository must itself be the plugin users install.

---

# 2. compatibility

target the current stable Claude Code mod API.

mods currently require Claude Code >= 2.1.287.

do not assume API names from this document are exact.

before implementation:

1. load the built-in `plugin-authoring` skill
2. inspect the generated TypeScript definitions for this installed Claude Code version
3. inspect current mod documentation/examples where needed
4. use the supported names and types from the installed version

prefer the actual generated API definitions over assumptions in this handoff.

---

# 3. open-source from day one

this is intended to become a public GitHub project.

design the repository accordingly.

suggested initial layout:

```text
slop-o-meter/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
│
├── hooks/
│   ├── hooks.json
│   └── register.ts
│
├── src/
│   ├── scoring/
│   │   ├── score.ts
│   │   ├── normalize.ts
│   │   └── config.ts
│   │
│   ├── metrics/
│   │   ├── diff.ts
│   │   ├── surface.ts
│   │   ├── complexity.ts
│   │   ├── abstractions.ts
│   │   ├── amplification.ts
│   │   ├── churn.ts
│   │   ├── dependencies.ts
│   │   ├── duplication.ts
│   │   ├── types.ts
│   │   ├── tests.ts
│   │   └── comments.ts
│   │
│   ├── git/
│   │   └── snapshot.ts
│   │
│   ├── ui/
│   │   ├── gauge.ts
│   │   ├── terminal.ts
│   │   └── pane.ts
│   │
│   └── state/
│       └── history.ts
│
├── tests/
│   └── fixtures/
│
├── README.md
├── DOGFOOD.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
└── package.json
```

this is guidance, not a demand for layers.

if a simpler structure is better, simplify it.

**do not create needless architecture inside a tool designed to detect needless architecture.**

---

# 4. plugin packaging

the repository must be a valid Claude Code plugin containing the mod.

include:

```text
.claude-plugin/plugin.json
hooks/hooks.json
hooks/register.ts
```

use TypeScript if the current mod loader supports it directly.

avoid a runtime build step unless there is a real reason for one.

the manifest should contain useful public metadata:

```json
{
  "name": "slop-o-meter",
  "displayName": "Slop-O-Meter",
  "version": "0.1.0",
  "description": "Metrics-driven detection of AI-generated code slop for Claude Code",
  "author": {
    "name": "Alan Currie"
  }
}
```

add valid repository/homepage fields once the GitHub URL exists.

use **MIT** for the initial open-source licence unless repository configuration says otherwise.

---

# 5. marketplace

this repository should also be able to act as its own Claude marketplace.

create:

```text
.claude-plugin/marketplace.json
```

using the plugin itself as:

```json
{
  "source": "./"
}
```

keep the manifest plugin name and marketplace plugin name identical.

the eventual user flow should be:

```bash
claude plugin marketplace add OWNER/slop-o-meter
claude plugin install slop-o-meter@slop-o-meter
```

document both marketplace installation and local development installation.

---

# 6. core product model

score each code-changing Claude turn:

```text
0 ───────────────────────────── 100
clean                          mud
```

initial states:

```text
0–20    CLEAN
21–40   MILD SLOP
41–60   GETTING SLOPPY
61–80   HEAVY SLOP
81–100  BIG BALL OF MUD
```

`BIG BALL OF MUD` is the critical alert state.

the thresholds must be configurable later.

---

# 7. two different concepts: do not mix them

distinguish:

## turn slop score

what did this agent turn introduce?

this is the primary product metric.

## repository mud / baseline

what condition was the repository already in?

this is context.

do not punish Claude merely because it edited an ugly old module.

a clean two-line fix in terrible legacy code should still be capable of scoring well.

therefore favour:

```text
delta introduced by this turn
```

over:

```text
absolute state of the file
```

wherever practical.

a future `Project Mud Index` may be useful, but keep it separate from the main Slop Score.

---

# 8. scoring requirements

the score must be:

- deterministic by default
- explainable
- based on observable data
- stable enough that small irrelevant changes do not wildly alter it
- capable of rewarding simplification
- resistant to raw line-count bias

store:

```text
raw metric
normalized metric
weight
contribution
reason
```

for every scoring component.

a user must always be able to ask:

> why is this 67?

and get a useful answer.

---

# 9. core metrics

## 9.1 change surface

measure things such as:

- number of files touched
- directories crossed
- packages/modules crossed
- production code areas touched
- additions
- deletions
- unrelated files changed
- change spread

large changes are not automatically bad.

we care about:

```text
unnecessary surface / required surface
```

rather than just:

```text
number of lines
```

---

# 9.2 complexity delta

where language analysis makes it practical, compare before and after:

- cyclomatic complexity
- cognitive complexity
- branch count
- nesting depth
- function size
- condition count

prefer:

```text
complexity_after - complexity_before
```

reward reductions.

---

# 9.3 abstraction growth

detect newly introduced concepts such as:

- classes
- services
- interfaces
- factories
- repositories
- adapters
- wrappers
- generic helpers
- modules
- types
- utility layers

one important smell:

```text
abstraction with exactly one consumer
```

do not blindly label it wrong.

use it as evidence.

derive useful values such as:

```text
new abstractions / meaningful behaviours added
```

---

# 9.4 change amplification

this is a first-class Slop-O-Meter metric.

measure roughly:

```text
implementation machinery / requested behaviour
```

example:

request:

```text
add a simple search endpoint
```

implementation:

```text
SearchService
SearchRepository
SearchRepositoryInterface
SearchFactory
SearchAdapter
SearchQueryBuilder
SearchConfig
```

that is strong amplification evidence.

possible signals:

- new files
- abstraction layers
- concepts introduced
- call depth
- plumbing
- configuration
- public API growth
- behaviour actually added

this metric should become one of our main differentiators.

---

# 9.5 agent churn

this is the other major differentiator.

because the mod can observe Claude's work while it happens, track:

- repeated edits to the same file
- code added then removed
- abandoned helpers
- abandoned files
- repeated failed attempts
- tool retries
- rewrites
- edit volume

derive something like:

```text
edit survival ratio =
final surviving change / total change performed
```

example:

Claude writes and rewrites 700 lines.

final diff contains 40 lines.

that should produce meaningful churn even though a normal static analyser sees only 40 lines.

do not punish sensible iteration too heavily.

look for excessive churn.

---

# 9.6 type weakening

start with strong TypeScript/JavaScript support.

track deltas such as:

- `any`
- unsafe `as`
- double casts
- `@ts-ignore`
- `@ts-expect-error`
- widened types
- broad index signatures
- suppression of compiler safety

prefer AST-level analysis where it gives meaningful accuracy.

avoid fragile regex systems pretending to understand the language.

---

# 9.7 dependency growth

detect:

- runtime dependencies added
- dev dependencies added
- new frameworks
- new tools

adding a substantial library to solve a trivial operation is a signal.

adding one as part of an explicitly requested migration may be perfectly valid.

---

# 9.8 duplication delta

measure whether the change:

- creates repeated logic
- copies existing implementations
- introduces near-identical helpers
- removes duplication

reward simplification.

---

# 9.9 comments/documentation noise

detect likely low-value generated text such as:

- comments restating the next line
- excessive JSDoc
- giant block explanations around obvious code
- duplicated documentation

do not punish useful documentation.

---

# 9.10 tests / risk reduction

track:

- meaningful tests added
- tests updated for new behaviour
- risky branches covered
- tests removed
- skipped tests
- disabled tests

tests should act primarily as a **risk-reduction modifier**, not as a licence to write bad code.

ten tests do not make seven unnecessary factories good.

---

# 10. initial scoring model

start with something close to:

```text
15  change surface
15  complexity delta
15  abstraction growth
15  change amplification
15  agent churn
10  type weakening
 5  dependency growth
 5  duplication delta
 5  comment/documentation noise
───
100
```

then allow a bounded risk-reduction modifier from meaningful tests and verified simplification.

for example:

```text
base structural score: 67
test/risk modifier:      -5
final score:             62
```

clamp final score:

```text
0..100
```

do not treat these initial weights as truth.

they are the hypothesis we dogfood.

---

# 11. score explanation

every completed turn should be able to produce something like:

```text
SLOP SCORE 67

+14  complexity increased
+13  abstraction growth
+12  change amplification
+10  agent churn
 +8  change surface
 +6  type weakening
 +5  duplication
 +3  comments
 -4  meaningful tests

TOP SIGNALS

+12  introduced 3 single-use abstractions
 +8  7 modules touched for one endpoint
 +7  62% of edit volume did not survive
 +5  added a runtime dependency
 -4  added behavioural tests
```

prefer concrete explanations over generic warnings.

---

# 12. live above-prompt UI

the mod should add a compact persistent indicator in Claude Code's `AbovePrompt` band.

examples:

```text
SLOP  18/100  CLEAN
```

```text
SLOP  ███████░░░░░░  42  GETTING SLOPPY ↗
```

while Claude is working, provisional data may be shown:

```text
SLOP  36?  analysing… ↗
```

do not claim false precision before the turn has completed.

the live number may primarily reflect measurable activity such as:

- edit count
- churn
- files touched
- change surface

then finalize the full score at turn completion.

---

# 13. full `/slop` pane

register:

```text
/slop
```

to open a detailed pane.

also support where practical:

```text
/slop explain
/slop diff
/slop history
/slop reset
/slop strict
```

if Claude Code command arguments do not work in the way assumed here, use the supported API and preserve equivalent behaviour.

the main pane should show:

```text
┌────────────────────────────────────┐
│          SLOP-O-METER              │
│                                    │
│           CUSTOM GAUGE             │
│                                    │
│              67                    │
│           HEAVY SLOP               │
│            ↑ 18                    │
│                                    │
│  budget             40             │
│  over budget       +27             │
│                                    │
│  score breakdown                   │
│  raw metrics                       │
│  top contributors                  │
│  positive signals                  │
│  changed files                     │
│  history                           │
└────────────────────────────────────┘
```

---

# 14. custom gauge — non-negotiable

do not ship a text-only dashboard.

the custom gauge is part of the product.

## desktop

Claude Code exposes `Svg` on Desktop.

use it.

create a proper semicircular gauge:

```text
            CLEAN       SLOP       MUD
          ╭──────────────────────────╮
        ╱                              ╲
      ╱    green yellow orange red      ╲
     ●────────────────▲──────────────────●

                     67
                 HEAVY SLOP
```

requirements:

- semicircular arc
- visual threshold zones
- current value
- state label
- needle/marker
- score trend
- theme-aware text
- readable at different pane sizes

the SVG should feel like an instrument gauge rather than a web progress bar.

---

# 15. gauge animation

normal score changes should move the needle cleanly.

target a short transition, roughly:

```text
200–400 ms
```

do not let animation slow work.

if direct SVG redraw is insufficient for smooth animation, investigate the mod `Client` element, which supports custom animated UI.

use the simplest supported mechanism.

animation must remain presentation only.

---

# 16. BIG BALL OF MUD transition

when a completed score crosses from below 81 to 81+:

```text
⚠ BIG BALL OF MUD
```

this should feel like hitting the red line.

desired behaviour:

1. needle accelerates toward the red
2. needle hits the critical zone
3. brief impact/pulse/shake
4. critical styling activates
5. `BIG BALL OF MUD` appears
6. diagnostics immediately explain why

do not repeat the dramatic alert continuously.

trigger the transition when **crossing** into the state.

afterward, render the normal persistent critical state.

---

# 17. mud visual identity

the UI may include a small mud-ball or mud-monster mark.

keep it memorable rather than childish.

the design language should feel like:

```text
serious developer telemetry
+
slightly unhinged warning instrument
```

the monster is presentation.

metrics remain the product.

---

# 18. terminal gauge

Desktop has `Svg`.

the terminal does not.

use terminal-specific rendering rather than forcing fake visual parity.

Claude Code provides `Raster` for terminal cell graphics.

build a compact terminal representation such as:

```text
SLOP-O-METER

████████████████▓▓░░  87/100
                    ▲
             BIG BALL OF MUD
```

or a more gauge-like raster if it remains readable.

use `$.ui.blit()` where useful for efficient raster animation/update.

keep a plain text fallback for environments where custom drawing is unavailable.

---

# 19. surface support

Claude Code mod UI is not shown in every environment.

design graceful fallbacks.

the main targets are:

- Claude Code terminal
- Code tab in Claude Desktop

when UI cannot render, the score should still be available from the command or transcript output where practical.

do not make core scoring depend on the UI.

---

# 20. state and history

persist score history.

store at least:

```text
timestamp / turn
final score
metric breakdown
raw metrics
changed files
trend
threshold state
```

example:

```text
turn 18   16  CLEAN
turn 19   23  MILD SLOP
turn 20   31  MILD SLOP
turn 21   63  HEAVY SLOP
turn 22   87  BIG BALL OF MUD
```

show a sparkline or compact trend where useful:

```text
12 → 18 → 21 → 34 → 67 → 87
```

---

# 21. slop budget

support an advisory budget.

default:

```text
40
```

show:

```text
budget       40
current      67
over        +27
```

default behaviour is **observe, not block**.

Slop-O-Meter must not normally prevent Claude from editing code.

---

# 22. strict mode

a future/experimental:

```text
/slop strict
```

may add feedback to a later Claude turn when the previous change exceeded budget.

example hidden guidance:

```text
The previous change exceeded the configured Slop budget.

Prefer deletion, reuse, direct implementations and existing patterns.

Do not introduce additional abstractions unless they are required by the task.
```

this feedback loop must be separate from scoring.

never change the numeric score because Claude obeyed or ignored our advice.

---

# 23. no LLM judge in the default MVP

do not use a model call to decide whether code is "slop".

the deterministic engine must stand on its own.

later we may add an optional semantic component using the mod model API for questions static analysis cannot easily answer, such as:

- speculative architecture
- solving beyond the request
- needless indirection
- strange abstractions

if added later:

```text
structural score    48
semantic signal     +5
──────────────────────
combined            53
```

requirements:

- off by default
- separately labelled
- capped influence
- no silent transmission of code
- deterministic score remains available

---

# 24. privacy and trust

this is an open-source mod that executes with the user's permissions.

treat trust as a product feature.

default behaviour:

- no telemetry
- no analytics
- no external network requests
- no remote storage
- no model calls for scoring
- no sending diffs outside the machine
- no automatic tool-call approval
- no secret/env collection

state this clearly in the README.

if a future optional feature changes this, require explicit opt-in.

keep the mod's declared capabilities as small as practical.

---

# 25. event strategy

use current supported mod events.

the rough conceptual lifecycle is:

```text
turn.start
    │
    ├─ capture git baseline
    │
    └─ reset per-turn activity
         │
         ▼
tool.call / turn activity
         │
         ├─ count edit operations
         ├─ count rewrites
         ├─ track touched files
         └─ build churn data
         │
         ▼
turn.complete
         │
         ├─ capture final git state
         ├─ compute diff
         ├─ run metric collectors
         ├─ normalize
         ├─ score
         ├─ persist
         └─ redraw UI
```

actual event names and available fields must come from the current API types.

---

# 26. git strategy

capture enough information at the start of the turn to measure what this turn introduced.

use git commands through the supported process API where appropriate.

consider:

```bash
git diff
git diff --numstat
git status --porcelain
```

but do not assume the repository begins clean.

the user may already have uncommitted work.

we therefore need a **turn baseline**, not simply:

```text
HEAD versus working tree
```

do not attribute pre-existing user changes to Claude.

this is important.

---

# 27. agent-edit accounting

for churn, observe editing activity during the turn rather than reconstructing it only from the final diff.

track enough information to derive:

```text
total lines/regions edited
final lines/regions surviving
files rewritten
edits per file
created then deleted files
temporary abstractions
tool retry patterns
```

avoid storing entire file contents in history unless required.

prefer compact statistics and hashes/snapshots where possible.

---

# 28. task-to-diff / amplification context

the request itself matters for change amplification.

capture enough turn context to estimate the size of requested behaviour.

do not create a full semantic AI classifier for v1.

start with deterministic proxies:

- number of files created
- layers introduced
- public symbols introduced
- amount of wiring
- final behaviour surface
- diff size
- number of existing concepts reused

later we can explore a semantic judge.

---

# 29. language support

MVP focus:

```text
TypeScript
JavaScript
```

build clean seams for future language support but do not build a giant language-plugin framework.

future possibilities:

```text
C#
Rust
Python
Go
Java
```

only add abstraction when the second implementation proves it is needed.

---

# 30. implementation phases

do not attempt every metric before we see anything working.

## phase 1 — boot

get a valid plugin/mod loading from this repository.

prove:

```text
session loads mod
/slop exists
AbovePrompt can draw
```

## phase 2 — vertical slice

implement:

- turn baseline
- final diff
- change surface
- basic churn
- simple score
- compact UI
- persistence

we should have a real working Slop-O-Meter very early.

## phase 3 — gauge

implement:

- desktop SVG gauge
- terminal gauge
- threshold states
- needle
- Big Ball of Mud transition

## phase 4 — serious metrics

add:

- complexity
- abstractions
- amplification
- type weakening
- dependencies
- duplication
- comments
- test modifier

## phase 5 — dogfood and calibrate

use the mod against itself.

## phase 6 — open-source polish

finish:

- README
- marketplace
- CI
- licence
- contribution guide
- changelog
- release validation

---

# 31. dogfood requirement

this is mandatory.

**Slop-O-Meter must build Slop-O-Meter while Slop-O-Meter watches it.**

once the vertical slice works, load the repository's own mod and continue development with it enabled.

record real results in:

```text
DOGFOOD.md
```

for each experiment record:

```text
task
expected outcome
raw metrics
score
score breakdown
actual outcome
false positives
false negatives
what we changed
```

---

# 32. dogfood experiment 1 — tiny direct change

perform a small direct implementation.

expected:

```text
low score
```

---

# 33. dogfood experiment 2 — deliberate over-engineering

on an isolated fixture/branch/test case, deliberately implement a trivial feature with:

- interface
- factory
- service
- adapter
- repository
- wrapper

expected:

```text
abstraction ↑
amplification ↑
score ↑ significantly
```

---

# 34. dogfood experiment 3 — large legitimate change

perform or simulate a large but coherent refactor.

expected:

```text
large diff
but not automatically BIG BALL OF MUD
```

this is crucial.

raw size must not dominate the model.

---

# 35. dogfood experiment 4 — simplification

take an over-engineered fixture and collapse it into a direct implementation.

expected:

```text
87  BIG BALL OF MUD
 ↓
31  MILD SLOP
```

show positive metric movement.

the gauge should visibly travel back out of the red.

---

# 36. dogfood experiment 5 — churn

make several approaches before producing a small final change.

expected:

```text
small final git diff
high agent churn
```

this proves the value of runtime agent observation.

---

# 37. dogfood experiment 6 — ugly legacy module

make a minimal clean change inside intentionally messy existing code.

expected:

```text
low/moderate turn score
```

do not penalize inherited debt.

---

# 38. dogfood experiment 7 — test effect

implement the same risky behaviour:

```text
A. without meaningful tests
B. with meaningful tests
```

B should show reduced risk.

tests must not erase structural slop.

---

# 39. dogfood experiment 8 — Slop-O-Meter itself

watch for the project itself growing:

- excessive files
- generic frameworks
- duplicated scoring abstractions
- unnecessary AST machinery
- factories
- wrappers
- configuration systems

if Slop-O-Meter crosses into:

```text
BIG BALL OF MUD
```

while being built:

1. capture the gauge
2. add it to `DOGFOOD.md`
3. identify why
4. simplify the project
5. record the new score

this is potentially the ideal README hero story.

---

# 40. calibration philosophy

do not tune metrics just to make a demo look good.

priority order:

1. correct relative ordering
2. useful explanations
3. low false-positive rate
4. predictable behaviour
5. exact numeric score

we care much more that:

```text
direct solution
<
normal solution
<
over-engineered solution
<
architectural disaster
```

than whether one test scores 43 rather than 46.

---

# 41. tests

keep the core scoring engine independent from Claude Code UI so it can be tested normally.

write unit tests for:

- metric collectors
- normalization
- scoring
- threshold mapping
- history
- gauge position calculations

write fixture-based tests.

prefer relational assertions:

```text
simple < over-engineered

simplified < original

low churn < high churn

no new dependency < unnecessary dependency

strong typing < introduced any

equivalent tested risky change < untested risky change
```

avoid brittle tests that assert every complete score exactly.

---

# 42. gauge tests

test:

- 0 position
- 100 position
- clamp outside range
- every threshold
- needle position
- state labels
- crossing into Big Ball of Mud
- leaving Big Ball of Mud after simplification
- Desktop rendering
- terminal fallback
- trend arrows

animation logic must not affect scoring tests.

---

# 43. mod integration tests

use Claude Code's current mod/plugin testing facilities.

verify:

- plugin loads
- command registers
- pane opens
- AbovePrompt renders
- history persists
- score redraw occurs
- other mods' AbovePrompt content is preserved rather than accidentally replaced
- unsupported surfaces fall back safely

do not hijack other mods' UI.

---

# 44. configuration

keep configuration deliberately small.

something like:

```ts
{
  budget: 40,

  thresholds: {
    clean: 20,
    mild: 40,
    sloppy: 60,
    heavy: 80
  },

  weights: {
    surface: 15,
    complexity: 15,
    abstractions: 15,
    amplification: 15,
    churn: 15,
    typeWeakening: 10,
    dependencies: 5,
    duplication: 5,
    comments: 5
  }
}
```

use the supported mod state/config mechanisms.

do not build a configuration framework.

---

# 45. performance

Slop-O-Meter must not make Claude Code feel slow.

requirements:

- cheap work during the turn
- heavier static analysis after edits/turn completion
- cache repository baseline work
- analyse changed files rather than scanning the whole repository repeatedly
- avoid model calls
- avoid unnecessary processes
- avoid blocking tool calls

profile before adding complexity.

---

# 46. failure behaviour

the mod must fail soft.

if:

- git is unavailable
- repository is not a git repo
- a language analyser fails
- a metric cannot be computed
- the UI surface lacks an element

do not break Claude Code.

record that metric as unavailable and continue with the remaining evidence.

show:

```text
complexity: unavailable
```

rather than inventing a value.

---

# 47. README

the README should lead strongly.

suggested opening:

```text
# Slop-O-Meter

Is your coding agent quietly building a Big Ball of Mud?

[GAUGE / GIF]

87 / 100
BIG BALL OF MUD
```

then immediately:

```text
Not an LLM vibe score.
```

explain that Slop-O-Meter measures:

- diff structure
- complexity delta
- abstraction growth
- change amplification
- edit churn
- type weakening
- dependencies
- duplication
- test risk reduction

also document:

- installation
- local dev
- scoring model
- privacy
- configuration
- `/slop`
- limitations
- supported languages
- contribution process

---

# 48. trust section in README

include a clear section stating:

```text
Slop-O-Meter does not send your source code anywhere.

By default it:
- makes no network requests
- uses no remote model
- collects no telemetry
- stores no cloud data
```

make the project's permissions and behaviour easy to audit.

---

# 49. CI

add GitHub Actions.

at minimum run:

```text
tests
typecheck
plugin validation
```

use the current supported command:

```bash
claude plugin validate --strict .
```

where available in the CI environment.

do not put Claude credentials in CI merely to test pure scoring code.

separate local/plugin validation from tests that can run without Claude Code if necessary.

---

# 50. release path

initial intended releases:

```text
0.1.0   deterministic core + gauge
0.2.0   churn + amplification calibration
0.3.0   stronger repo baseline / analysis
0.4.0   additional language support
1.0.0   stable scoring model
```

do not manufacture versions just to match this list.

release based on useful milestones.

use semantic versioning.

increment the manifest version for releases if using version-based marketplace updates.

---

# 51. public distribution

the same repository should support:

```text
GitHub source
   ↓
self-hosted Claude marketplace
   ↓
Claude Code installation
```

after the project is mature enough, prepare it for possible submission to Anthropic's plugin directory.

do not make directory acceptance an MVP dependency.

---

# 52. contributor experience

add a concise `CONTRIBUTING.md`.

a contributor should be able to:

```bash
git clone ...
cd slop-o-meter
install dev dependencies
run tests
run typecheck
validate plugin
start Claude Code with local plugin
```

keep the contributor setup small.

---

# 53. scope control

for MVP, do not build:

- hosted services
- accounts
- dashboards
- cloud telemetry
- databases
- MCP servers
- generic plugin frameworks
- huge AST frameworks
- AI scoring pipelines
- organisation policy systems

unless they become demonstrably necessary.

local mod.

local metrics.

great UI.

great explanations.

---

# 54. product question every abstraction must answer

before introducing an internal abstraction, ask:

```text
does this make Slop-O-Meter simpler today,
or are we guessing about tomorrow?
```

if it is the latter, don't add it yet.

---

# 55. final MVP acceptance criteria

the project is ready for an initial public release when:

- [ ] valid Claude Code plugin
- [ ] loads locally
- [ ] deterministic Slop Score
- [ ] turn-level git baseline
- [ ] existing user changes are not counted as Claude changes
- [ ] change surface metric
- [ ] complexity delta
- [ ] abstraction growth
- [ ] change amplification
- [ ] agent churn
- [ ] type weakening
- [ ] dependency growth
- [ ] duplication signal
- [ ] test/risk modifier
- [ ] score explanation
- [ ] AbovePrompt status
- [ ] `/slop` pane
- [ ] desktop custom gauge
- [ ] terminal gauge
- [ ] needle movement
- [ ] `BIG BALL OF MUD` critical state
- [ ] history
- [ ] configurable budget
- [ ] persistent state
- [ ] automated tests
- [ ] dogfood evidence
- [ ] privacy/no-telemetry statement
- [ ] plugin validation
- [ ] marketplace metadata
- [ ] README
- [ ] LICENSE
- [ ] CONTRIBUTING
- [ ] CI

---

# 56. definition of success

Slop-O-Meter should correctly rank:

```text
tiny direct fix
      <
sensible implementation
      <
needlessly broad implementation
      <
enterprise astronautics
      <
BIG BALL OF MUD
```

and it must also recognize improvement:

```text
BIG BALL OF MUD
87
       │
       │ simplify
       ▼
29
MILD SLOP
```

without needing an LLM to tell it that happened.

---

# 57. design tone

the product should feel:

```text
Grafana
×
car dashboard warning light
×
developer humour
```

not:

```text
novelty meme plugin
```

the gauge and mud state make people notice it.

the metrics make them keep it installed.

---

# 58. work style

implement rather than endlessly planning.

make small commits or logical checkpoints.

after each major slice:

1. run tests
2. validate the plugin
3. load it
4. exercise it
5. inspect its own Slop Score
6. simplify if necessary

show working behaviour as early as possible.

when faced with several valid designs, choose the smallest one that preserves our intended product direction.

do not ask for architectural approval unless genuinely blocked.

---

# 59. first execution sequence

start now with:

```text
1. inspect repository
2. load plugin-authoring guidance/current API types
3. scaffold minimal valid plugin in THIS repository
4. make it load
5. register /slop
6. draw a simple AbovePrompt state
7. capture a per-turn git baseline
8. calculate the first deterministic metric
9. display the first real score
10. commit/checkpoint the vertical slice
```

then build outward from working software.

do not begin by implementing every metric.

---

# 60. final rule

Slop-O-Meter itself is not exempt.

if you create needless:

- factories
- wrappers
- interfaces
- layers
- dependencies
- files
- generic systems

while building it, Slop-O-Meter should eventually catch you.

when it does:

**believe the meter.**

i’ve also tightened two things from our earlier versions. mods really are plugins, and the current docs explicitly support an `AbovePrompt` band, panes, Desktop `Svg`, terminal `Raster`, `Client` regions for animation, and `$.ui.blit()` for updating a raster without a full redraw. :chatgpt-content-reference{index="0"}

for open source, the current publishing flow also supports keeping `.claude-plugin/marketplace.json` in the **same repo**, pointing its plugin entry at `"./"`, then installing via a GitHub marketplace source. `claude plugin validate --strict` is the right release gate. :chatgpt-content-reference{index="1"}

the strongest addition here is separating **turn slop** from **existing repository mud**. without that, the tool would punish an agent for touching legacy rubbish it didn't create, which would make the metric much less useful.