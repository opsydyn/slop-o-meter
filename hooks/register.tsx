import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { diffTrees, findRepo, snapshot, type Repo, type Run } from '../src/git.ts'
import { explain, lineDiff, scoreTurn, type Scored } from '../src/score.ts'
import type { SlopRecord, SlopState } from '../types/index.d.ts'

const PANE = 'slop'
const HISTORY_LIMIT = 200
const turn = atom({ plugin: 'slop-o-meter', key: 'turn' } as const, null)
const last = atom({ plugin: 'slop-o-meter', key: 'last' } as const, null)
const history = atom({ plugin: 'slop-o-meter', key: 'history' } as const, [])

const COLORS: Record<SlopState, string> = {
  'CLEAN': '#3fb950',
  'MILD SLOP': '#a3c43a',
  'GETTING SLOPPY': '#d29922',
  'HEAVY SLOP': '#f0883e',
  'BIG BALL OF MUD': '#f85149',
}

let repo: Repo | null | undefined

function runner($: EngineInterface): Run {
  return async (argv, init) => {
    const r = await $.process.run(argv, { env: init?.env, timeoutMs: 20_000 })
    return { exitCode: r.exitCode, stdout: r.stdout }
  }
}

async function getRepo($: EngineInterface): Promise<Repo | null> {
  if (repo === undefined) repo = await findRepo(runner($))
  return repo
}

const storeKey = (r: Repo) => `history:${r.root}`
const relative = (r: Repo, path: string) =>
  path.startsWith(`${r.root}/`) ? path.slice(r.root.length + 1) : null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'slop',
      description: 'Slop-O-Meter: the last turn\'s slop score. Args: explain, diff, history, reset',
    })
    const r = await getRepo($)
    if (r) {
      const saved = ((await $.store.get(storeKey(r))) ?? []) as SlopRecord[]
      await update($, history, () => saved)
      await update($, last, () => saved.at(-1) ?? null)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const r = await getRepo($)
    const baseline = r ? await snapshot(runner($), r) : null
    await update($, turn, () => ({ baseline, edits: {} }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    const r = await getRepo($)
    const path = r && relative(r, e.file_path)
    const before = e.tool === 'Write' ? await $.fs.read(e.file_path).catch(() => '') : e.old_string
    const result = await next(e)
    if (!path || 'deny' in result || result.isError) return result
    const after = e.tool === 'Write' ? e.content : e.new_string
    const { added, deleted } = lineDiff(before, after)
    await update($, turn, t => {
      if (!t) return t
      const was = t.edits[path] ?? { ops: 0, added: 0, deleted: 0 }
      const now = { ops: was.ops + 1, added: was.added + added, deleted: was.deleted + deleted }
      return { ...t, edits: { ...t.edits, [path]: now } }
    })
    return result
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

    const scored = scoreTurn({ changes, edits: t.edits })
    const previous = await read($, last)
    const record = toRecord(scored, changes, previous)
    const all = [...(await read($, history)), record].slice(-HISTORY_LIMIT)
    await update($, history, () => all)
    await update($, last, () => record)
    await $.store.set(storeKey(r), all)
    if (record.state === 'BIG BALL OF MUD' && previous?.state !== 'BIG BALL OF MUD') {
      $.ui.toast(`⚠ BIG BALL OF MUD: slop score ${record.score}. /slop explain says why.`)
    }
    return next(e)
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
    if (!record) return { text: 'Slop-O-Meter: no scored turns yet.' }
    if (arg === 'diff') {
      return { text: record.changes.map(c => `+${c.added} -${c.deleted}  ${c.path}`).join('\n') || 'No file changes.' }
    }
    if (arg === '') await $.ui.open({ id: PANE, title: 'Slop-O-Meter' })
    return { text: explain(record) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const record = await read($, last)
    const t = e.props.isWorking ? await read($, turn) : null
    const files = t ? Object.keys(t.edits).length : 0
    const ops = t ? Object.values(t.edits).reduce((n, f) => n + f.ops, 0) : 0
    return (
      <Box>
        <Text bold>SLOP </Text>
        {record ? (
          <Text color={COLORS[record.state]}>
            {bar(record.score, 12)} {String(record.score).padStart(3)}  {record.state} {trend(record.delta)}
          </Text>
        ) : (
          <Text dimColor>— no scored turns yet</Text>
        )}
        {t && <Text dimColor>  · analysing… {ops} edits in {files} files</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const record = await read($, last)
    const rows = await read($, history)
    if (!record) return <Text dimColor>No scored turns yet.</Text>
    return (
      <Box flexDirection="column">
        <Text bold>SLOP-O-METER</Text>
        <Text color={COLORS[record.state]} bold>
          {bar(record.score, Math.min(40, e.props.bodyColumns - 8))} {record.score}
        </Text>
        <Text color={COLORS[record.state]}>{record.state} {trend(record.delta)}</Text>
        <Text> </Text>
        {explain(record).split('\n').slice(2).map(line => <Text>{line}</Text>)}
        <Text> </Text>
        <Text dimColor>history  {rows.slice(-12).map(h => h.score).join(' → ')}</Text>
      </Box>
    )
  })
}

function toRecord(s: Scored, changes: SlopRecord['changes'], previous: SlopRecord | null): SlopRecord {
  return {
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

function trend(delta: number | null): string {
  if (delta === null || delta === 0) return ''
  return delta > 0 ? `↗ +${delta}` : `↘ ${delta}`
}
