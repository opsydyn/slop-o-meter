# Changelog

## 0.1.0: unreleased

First release: a deterministic core and the gauge.

- Turn baselines: the working tree is snapshotted at the start and end of each turn through a private git
  index, so pre-existing uncommitted work is never attributed to the agent.
- Ten scoring components: change surface, complexity delta, abstraction growth, change amplification, agent
  churn, type weakening, dependency growth, duplication delta, comment noise, and a bounded test/risk modifier.
- A small JS/TS lexer for the structural metrics; other languages get surface, churn and dependencies.
- Scores combine as independent evidence and explain themselves component by component.
- The `AbovePrompt` band (shared: other mods' band content is kept), the `/slop` pane and `explain`,
  `diff`, `history`, `reset`.
- An SVG gauge (desktop, VS Code, mobile) with needle animation and a one-time Big Ball of Mud slam; a
  raster gauge in the terminal.
- Per-repository history, an advisory `budget` setting, no network access, no telemetry.
- Calibrated against fixture scenarios and seven live dogfood experiments (DOGFOOD.md).
