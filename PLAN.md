# Slop-O-Meter build plan

Vision: `slop-o-meter.md`. This file is the working plan against the real mod API (Claude Code 2.1.286).

## Decisions

- **Turn baseline**: at `turn.start` and `turn.complete` the whole working tree is written as a git tree
  through a private index (`.git/slop-o-meter.index`, `git add -A` + `git write-tree`). The turn's change is
  `git diff --numstat <before> <after>`. Pre-existing user work is never attributed; the real index, stash
  and refs are never touched. (`src/git.ts`)
- **Churn**: `tool.call` on Edit/Write records git-style line diffs of each edit (`lineDiff`); compared with
  the final net diff it gives edit survival. Edits made through Bash are invisible to churn (documented limitation).
- **Analysis without Node**: the mod runtime has no Node and no npm imports, so language analysis will be a
  small real lexer (strings, comments, templates, regex, brace nesting), not a TS compiler.
- **Normalisation**: each raw metric → `saturate(x, k) = 1 − e^(−x/k)`; metrics that cannot be computed are
  excluded and the remaining weights rescaled (never zeroed, never invented).
- **Avoid triple counting**: surface = spread; abstractions = new symbols (single-consumer weighted);
  amplification = machinery per unit of behaviour added.
- **Gauge animation**: desktop `Svg` with `isInteractive` + SMIL `animateTransform` from previous to new
  angle; terminal `Raster` frames via `$.ui.blit`. No `Client` unless needed.
- **State**: live values in `$.state` (survive hot reload); history in `$.store` keyed by repo root, 200 turns.
- **Dev loading**: the repo is symlinked into the session's dev-mods folder; the repo stays canonical.

## Steps

1. [x] Boot: manifest, `/slop`, AbovePrompt band, validates.
2. [x] Vertical slice: baseline, diff, surface + churn, score + explanation, history. → dogfood next.
3. [x] Gauge: SVG gauge + needle animation, terminal raster gauge, text fallback, mud crossing.
4. [ ] Metrics: lexer → complexity, abstractions, amplification, type weakening, deps, duplication, comments, test modifier.
5. [ ] Dogfood: the eight experiments in DOGFOOD.md; calibrate `k` values and weights.
6. [ ] Polish: README (trust section), CI (bun test, tsc, `claude plugin validate --strict`), CONTRIBUTING, CHANGELOG, marketplace.json.
