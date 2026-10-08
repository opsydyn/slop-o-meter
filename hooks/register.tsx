import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { crossedIntoMud, colorOf, gaugeCells, gaugeSvg, sweep } from '../src/gauge.ts'
import { diffTrees, findRepo, readFiles, snapshot, type Repo, type Run } from '../src/git.ts'
import { ANALYZABLE } from '../src/analyze.ts'
import { CELL_ROWS, planetnikAlt, planetnikCells, planetnikFace, planetnikSvg, WIDTH } from '../src/mascot.ts'
import { briefing, nudgesFor, report, simplifyPrompt, strictNote } from '../src/feedback.ts'
import { explain, lineDiff, scoreTurn, type FileVersion, type Scored } from '../src/score.ts'
import type { SlopRecord } from '../types/index.d.ts'

const PANE = 'slop'
const GAUGE = 'gauge'
const HISTORY_LIMIT = 200
/** A result younger than this animates its needle when drawn; older ones draw still. */
const FRESH_MS = 8000
const turn = atom({ plugin: 'slop-o-meter', key: 'turn' } as const, null)
const last = atom({ plugin: 'slop-o-meter', key: 'last' } as const, null)
const history = atom({ plugin: 'slop-o-meter', key: 'history' } as const, [])
const since = atom({ plugin: 'slop-o-meter', key: 'since' } as const, null)

let repo: Repo | null | undefined
/** Width of the terminal gauge as last drawn, so a sweep can blit the mounted raster. */
let rasterColumns: number | null = null
/** Whether the terminal pane last drew Płanetnik, so a fresh result can animate him. */
let planetnikShown = false

function runner($: EngineInterface): Run {
  return async (argv, init) => {
    const r = await $.process.run(argv, { env: init?.env, stdin: init?.stdin, timeoutMs: 20_000 })
    return { exitCode: r.exitCode, stdout: r.stdout }
  }
}

async function getRepo($: EngineInterface): Promise<Repo | null> {
  if (repo === undefined) repo = await findRepo(runner($))
  return repo
}

/** Sweeps the terminal needle from the previous score; flashes when crossing into mud. */
function animateRaster($: EngineInterface, record: SlopRecord) {
  const columns = rasterColumns
  if (columns === null || record.delta === null || record.delta === 0) return
  const previous = record.score - record.delta
  const crossing = crossedIntoMud(record.score, previous)
  const frames = sweep(previous, record.score, 9, crossing)
    .map(s => gaugeCells(s, columns))
  if (crossing) frames.push(gaugeCells(record.score, columns, true), gaugeCells(record.score, columns))
  let i = 0
  const timer = $.clock.every(33, async () => {
    const cells = frames[i++]
    const done = !cells ||
      'deny' in (await $.ui.blit({ requestId: PANE, key: GAUGE, cells, columns, rows: 2 }))
    if (done || i >= frames.length) timer.cancel()
  })
}

const crossingOf = (record: SlopRecord) =>
  crossedIntoMud(record.score, record.delta === null ? null : record.score - record.delta)

/** Plays Płanetnik's weather once in the terminal after a scored turn, striking first when it crossed into mud. */
function animatePlanetnik($: EngineInterface, record: SlopRecord) {
  if (!planetnikShown) return
  const strike = crossingOf(record) ? [0, 1, 2].map(f => planetnikCells(record.score, f, { strike: f !== 1 })) : []
  const frames = [...strike, ...Array.from({ length: 12 }, (_, f) => planetnikCells(record.score, f)), planetnikCells(record.score)]
  let i = 0
  const timer = $.clock.every(140, async () => {
    const cells = frames[i++]
    const done = !cells ||
      'deny' in (await $.ui.blit({ requestId: PANE, key: 'planetnik', cells, columns: WIDTH, rows: CELL_ROWS }))
    if (done || i >= frames.length) timer.cancel()
  })
}

/** Changed source files and manifests, both sides, skipping anything huge. */
async function readVersions(run: Run, r: Repo, before: string, after: string, changes: SlopRecord['changes']): Promise<FileVersion[]> {
  const paths = changes
    .filter(c => (ANALYZABLE.test(c.path) || /(^|\/)package\.json$/.test(c.path)) && c.added + c.deleted < 5000)
    .slice(0, 60)
    .map(c => c.path)
  const [old, now] = await Promise.all([readFiles(run, r, before, paths), readFiles(run, r, after, paths)])
  return paths
    .map(path => ({ path, before: old.get(path) ?? null, after: now.get(path) ?? null }))
    .filter(f => (f.before?.length ?? 0) < 400_000 && (f.after?.length ?? 0) < 400_000)
}

const storeKey = (r: Repo) => `history:${r.root}`
const relative = (r: Repo, path: string) =>
  path.startsWith(`${r.root}/`) ? path.slice(r.root.length + 1) : null

export const register: Register = (on, options) => {
  const budget = typeof options.budget === 'number' ? options.budget : 40
  const mascot = options.mascot !== false
  /** off: observe only. nudge: mid-turn notes to Claude. strict: also a note after an over-budget turn. */
  const guard = options.guard === 'off' || options.guard === 'strict' ? options.guard : 'nudge'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'slop',
      description: 'Slop-O-Meter: the last turn\'s slop score. Args: explain, diff, history, report, reset',
    })
    await update($, since, at => at ?? Date.now())
    const r = await getRepo($)
    if (r) {
      const saved = ((await $.store.get(storeKey(r))) ?? []) as SlopRecord[]
      await update($, history, () => saved)
      await update($, last, () => saved.at(-1) ?? null)
    }
    return next(e)
  })

  // While the guard is on, Claude is told up front what is measured, in a context block of its own.
  on('prompt.context', async ($, e, next) => {
    const context = await next(e)
    if (guard === 'off') return context
    return { ...context, blocks: [...context.blocks, { name: 'slopOMeter', text: briefing(budget) }] }
  })

  on('turn.start', async ($, e, next) => {
    const r = await getRepo($)
    const baseline = r ? await snapshot(runner($), r) : null
    await update($, turn, () => ({ baseline, edits: {}, request: e.text }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    const r = await getRepo($)
    const path = r && relative(r, e.file_path)
    // null when Write creates the file.
    const before = e.tool === 'Write' ? await $.fs.read(e.file_path).catch(() => null) : e.old_string
    const result = await next(e)
    if (!path || 'deny' in result || result.isError) return result
    const after = e.tool === 'Write' ? e.content : e.new_string
    const { added, deleted } = lineDiff(before ?? '', after)
    await update($, turn, t => {
      if (!t) return t
      const was = t.edits[path] ?? { ops: 0, added: 0, deleted: 0 }
      const now = { ops: was.ops + 1, added: was.added + added, deleted: was.deleted + deleted }
      return { ...t, edits: { ...t.edits, [path]: now } }
    })
    const t = guard === 'off' ? null : await read($, turn)
    if (!t) return result
    // The guard: a note only the model reads, beside this tool's result. It never blocks the edit.
    const { nudges, concepts, docs } = nudgesFor(t, path, before, after)
    await update($, turn, x => x && { ...x, concepts, docs, nudged: [...(x.nudged ?? []), ...nudges.map(n => n.key)] })
    if (nudges.length === 0) return result
    $.ui.toast(`Slop-O-Meter nudged Claude: ${nudges.map(n => n.signal).join(', ')}`)
    return { ...result, context: [...(result.context ?? []), ...nudges.map(n => n.text)] }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const t = await read($, turn)
    await update($, turn, () => null)
    const r = await getRepo($)
    if (!r || !t?.baseline) return next(e)
    const run = runner($)
    const final = await snapshot(run, r)
    if (!final) return next(e)
    const changes = await diffTrees(run, r, t.baseline, final)
    if (changes.length === 0 && Object.keys(t.edits).length === 0) return next(e)

    const files = await readVersions(run, r, t.baseline, final, changes)
    const scored = scoreTurn({ changes, edits: t.edits, files, request: t.request })
    const previous = await read($, last)
    const record = toRecord(scored, changes, previous, (t.nudged ?? []).map(key => key.split(':')[0]!))
    const all = [...(await read($, history)), record].slice(-HISTORY_LIMIT)
    await update($, history, () => all)
    await update($, last, () => record)
    await $.store.set(storeKey(r), all)
    animateRaster($, record)
    if (mascot) animatePlanetnik($, record)
    if (crossedIntoMud(record.score, previous?.score ?? null)) {
      $.ui.toast(`⚠ BIG BALL OF MUD: slop score ${record.score}. /slop explain says why.`)
    }
    const done = await next(e)
    const note = guard === 'strict' ? strictNote(record, budget) : null
    if (note) {
      // The model reads the note at the start of the next turn; the notice tells the person it was left.
      // Either may be refused (another plugin can deny a row): feedback is never worth failing the turn.
      const told = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: note }] } }).catch(() => null)
      if (told && !('deny' in told && told.deny)) {
        await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `Slop-O-Meter left Claude a strict-mode note: the last change scored ${record.score}, over the budget of ${budget}.` }] } }).catch(() => null)
      }
    }
    return done
  })

  on('command.run', { command: 'slop' }, async ($, e) => {
    const arg = e.args.trim()
    const record = await read($, last)
    if (arg === 'reset') {
      const r = await getRepo($)
      if (r) await $.store.delete(storeKey(r))
      await update($, history, () => [])
      await update($, last, () => null)
      return { text: 'Slop-O-Meter history cleared for this repository.' }
    }
    if (arg === 'history') {
      const rows = (await read($, history)).slice(-20)
      return { text: rows.length ? rows.map(h => `${new Date(h.at).toLocaleTimeString()}  ${String(h.score).padStart(3)}  ${h.state}`).join('\n') : 'No scored turns yet.' }
    }
    if (arg === 'report') {
      const from = (await read($, since)) ?? 0
      return { text: report((await read($, history)).filter(h => h.at >= from), budget) }
    }
    if (!record) return { text: 'Slop-O-Meter: no scored turns yet.' }
    if (arg === 'diff') {
      return { text: record.changes.map(c => `+${c.added} -${c.deleted}  ${c.path}`).join('\n') || 'No file changes.' }
    }
    if (arg === '') await $.ui.open({ id: PANE, title: 'Slop-O-Meter' })
    return { text: `${explain(record)}\n\nbudget ${budget}  ${overBudget(record.score, budget)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const record = await read($, last)
    const t = e.props.isWorking ? await read($, turn) : null
    const files = t ? Object.keys(t.edits).length : 0
    const ops = t ? Object.values(t.edits).reduce((n, f) => n + f.ops, 0) : 0
    // The band is shared: draw whatever other mods (and the engine) put beneath us too.
    const below = await next(e)
    return (
      <Box flexDirection="column">
      <Box>
        <Text bold>SLOP </Text>
        {record ? (
          <Text color={colorOf(record.score)}>
            {bar(record.score, 12)} {String(record.score).padStart(3)}  {record.state} {trend(record.delta)}
          </Text>
        ) : (
          <Text dimColor>— no scored turns yet</Text>
        )}
        {mascot && record && <Text color="#a39b8e">  {planetnikFace(record.score)}</Text>}
        {t && <Text dimColor>  · analysing… {ops} edits in {files} files</Text>}
      </Box>
      {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const record = await read($, last)
    const rows = await read($, history)
    const width = e.props.bodyColumns
    const { Box, Button, Text } = $.ui.resolve(e)
    if (!record) return <Text dimColor>No scored turns yet. The meter scores each turn that changes code.</Text>

    const color = colorOf(record.score)
    const ranked = [...record.components].sort((a, b) => b.contribution - a.contribution)
    let gauge
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const columns = Math.max(10, Math.min(48, width - 2))
      rasterColumns = columns
      planetnikShown = mascot && width >= WIDTH + 2
      gauge = (
        <Box flexDirection="column">
          {planetnikShown && <Raster key="planetnik" columns={WIDTH} rows={CELL_ROWS} cells={planetnikCells(record.score)} />}
          <Raster key={GAUGE} columns={columns} rows={2} cells={gaugeCells(record.score, columns)} />
          <Text color={color} bold>
            {record.score}/100  {record.state === 'BIG BALL OF MUD' ? '⚠ ' : ''}{record.state} {trend(record.delta)}
          </Text>
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      const animate = Date.now() - record.at < FRESH_MS
      gauge = (
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap={2}>
          <Svg
            key={GAUGE}
            source={gaugeSvg({ ...record, animate })}
            alt={`Slop score ${record.score} of 100: ${record.state}`}
            width={Math.min(mascot ? 280 : 320, width * 8)}
            isInteractive={animate}
          />
          {mascot && (
            <Svg
              key="planetnik"
              source={planetnikSvg(record.score, { animate, crossing: animate && crossingOf(record) })}
              alt={planetnikAlt(record.score)}
              width={Math.min(180, width * 4)}
              isInteractive={animate}
            />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>SLOP-O-METER</Text>
        {gauge}
        <Text> </Text>
        <Text>budget {budget}  <Text color={record.score > budget ? '#f0883e' : '#3fb950'}>{overBudget(record.score, budget)}</Text></Text>
        <Text dimColor>
          guard {guard}{record.nudges?.length ? `  ·  nudged Claude this turn: ${record.nudges.join(', ')}` : ''}
        </Text>
        {record.score > 20 && (
          <Button
            key="simplify"
            label="Simplify this change"
            hotkey="s"
            onPress={() => $.prompt.submit({ text: simplifyPrompt(record) })}
          />
        )}
        <Text> </Text>
        <Text bold>score breakdown</Text>
        {ranked.map(c => (
          <Text wrap="truncate-end">
            <Text color={c.normalized === null ? undefined : colorOf(c.normalized * 100)}>
              {c.normalized === null ? '   –' : signedPoints(c.contribution).padStart(4)}
            </Text>
            {'  '}{c.label}<Text dimColor>  {c.normalized === null ? 'unavailable' : c.reason}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text bold>changed files</Text>
        {record.changes.slice(0, 12).map(c => (
          <Text wrap="truncate-start" dimColor>
            <Text color="#3fb950">+{c.added}</Text> <Text color="#f85149">-{c.deleted}</Text>  {c.path}
          </Text>
        ))}
        {record.changes.length > 12 && <Text dimColor>  …{record.changes.length - 12} more</Text>}
        <Text> </Text>
        <Text bold>history</Text>
        <Text>{spark(rows.slice(-Math.max(8, width - 4)).map(h => h.score))}</Text>
        <Text dimColor>{rows.slice(-6).map(h => h.score).join(' → ')}</Text>
      </Box>
    )
  })
}

function toRecord(s: Scored, changes: SlopRecord['changes'], previous: SlopRecord | null, nudges: string[]): SlopRecord {
  return {
    nudges,
    at: Date.now(),
    score: s.score,
    state: s.state,
    delta: previous ? s.score - previous.score : null,
    components: s.components,
    changes: changes.slice(0, 50),
  }
}

function bar(score: number, width: number): string {
  const filled = Math.round((score / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

function spark(scores: number[]): string {
  return scores.map(s => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(s / 12.5))]).join('')
}

function signedPoints(points: number): string {
  const n = Math.round(points)
  return n > 0 ? `+${n}` : String(n)
}

function trend(delta: number | null): string {
  if (delta === null || delta === 0) return ''
  return delta > 0 ? `↗ +${delta}` : `↘ ${delta}`
}

function overBudget(score: number, budget: number): string {
  return score > budget ? `over by +${score - budget}` : `under by ${budget - score}`
}
