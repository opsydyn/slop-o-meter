# Contributing

Keep it small. Slop-O-Meter is not exempt from its own measurements: before adding an abstraction, ask
whether it makes the project simpler today or guesses about tomorrow.

## Setup

```bash
git clone https://github.com/<owner>/slop-o-meter
cd slop-o-meter
bun install                              # dev only: TypeScript and test typings
bun test .spec.                          # scoring, lexer, git and gauge tests; no Claude Code needed
claude plugin validate --strict .        # the manifest and hooks module, as the engine reads them
```

To typecheck the hooks module too, write Claude Code's type declarations into `.claude/types` by running
`/plugin-types` inside a Claude Code session in this folder, then:

```bash
bunx tsc -p .
```

CI typechecks everything except the hooks module (`tsconfig.ci.json`), and validates the plugin.

## Layout

| Path | What |
|---|---|
| `hooks/register.tsx` | the mod: turn events, edit tracking, `/slop`, the band and the pane |
| `src/git.ts` | turn snapshots through a private index; diffs; reading both sides of a change |
| `src/analyze.ts` | the JS/TS lexer and the per-file facts |
| `src/score.ts` | metrics, the evidence combination, explanations |
| `src/gauge.ts` | the SVG gauge and terminal raster, as pure functions |
| `src/feedback.ts` | the guard: mid-turn nudges, the strict-mode note, the Simplify prompt, `/slop report` |
| `src/delight.ts` | Płanetnik's verdict, the Sunbreak, the forecast, milestones |
| `src/mascot.ts` | Płanetnik: one pixel grid per score, drawn as SVG and as terminal cells |
| `types/index.d.ts` | the mod's state contract and shared types |
| `tests/fixtures/scenarios.ts` | whole-turn scenarios; two are recorded live experiments |
| `tests/*.spec.ts` | the scoring core, lexer, git snapshots and gauge (`bun test .spec.`) |
| `tests/mod.test.tsx` | the mod in the engine's test host: band, pane, `/slop` (`claude plugin test .`) |

The scoring core never imports Claude Code, so it is tested with plain `bun test`; the mod's drawing and
commands are tested by `claude plugin test .` on both the terminal and desktop surfaces.

## Running it locally

Load the plugin from your checkout for one session:

```bash
claude --plugin-dir .
```

For a session that hot-reloads as you edit, add the checkout's absolute path to `CLAUDE_CODE_PLUGIN_DIRS`
(in your environment, or the `env` block of `~/.claude/settings.json`).

If you develop through a session's dev-mods folder (the `plugin-authoring` skill's hot reload), make the
entry there a **copy** of the plugin files, not a symlink to this repository: edits made through a symlink are
never reloaded, and the session keeps running stale code. Sync after each change:

```bash
rsync -a --delete --exclude='/.claude-plugin/types' --include='/.claude-plugin/***' --include='/hooks/***' --include='/src/***' --include='/types/***' --include='/package.json' --exclude='*' ./ ~/.claude/dev-mods/<session>/slop-o-meter/
```

## Changing the scoring

1. Add or adjust a scenario in `tests/fixtures/scenarios.ts` that shows the problem.
2. Assert the **ordering** you expect in `tests/scenarios.spec.ts` (`simple < over-engineered`), not exact scores.
3. Change the metric. `bun test scenarios.spec` prints every scenario's score for comparison.
4. Record what you saw, what you changed and why in `DOGFOOD.md`.

Do not tune a metric to make one demo look good. Relative ordering, useful explanations and few false
positives matter more than any single number.

## Releases

Semantic versioning. Bump `version` in `.claude-plugin/plugin.json` and `package.json`, add a `CHANGELOG.md`
entry, and tag `vX.Y.Z`.
