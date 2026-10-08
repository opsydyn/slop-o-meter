// Mod integration tests, run by `claude plugin test` against the engine itself.
// (The pure scoring tests are tests/*.spec.ts, run by `bun test`.)

import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import type { SlopRecord } from '../types/index.d.ts'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/work/shop'
/** Each snapshot is a new tree, so a turn's start and end differ. */
let tick = 0

/**
 * A session in a repository whose stored history ends with `record`: git answers
 * the repository root, the store holds the history, and the session starts.
 */
async function sessionWith($: Engine, on: On, record?: SlopRecord, numstat = '') {
  // Git, as far as the mod asks it: the repository root, and a tree id for every snapshot.
  on('process.run', ($, e) => {
    const stdout = e.argv[1] === 'rev-parse' ? `${ROOT}\n${ROOT}/.git\n`
      : e.argv.includes('write-tree') ? `tree${tick++}\n`
      : e.argv.includes('--numstat') ? numstat : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The engine's own band, beneath every mod: empty here.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  mock.store(on, record ? { [`history:${ROOT}`]: [record] } : {})
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true })
}

const BAND = {
  plugin: 'slop-o-meter',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const PANE = {
  plugin: 'slop-o-meter',
  component: 'Pane',
  requestId: 'slop',
  props: { title: 'Slop-O-Meter', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const RECORD: SlopRecord = {
  at: 0,
  score: 87,
  state: 'BIG BALL OF MUD',
  delta: 24,
  components: [
    { key: 'abstractions', label: 'abstraction growth', weight: 15, normalized: 1, contribution: 40, raw: {}, reason: '6 new abstractions' },
    { key: 'churn', label: 'agent churn', weight: 15, normalized: null, contribution: 0, raw: {}, reason: '' },
  ],
  changes: [{ path: 'src/count/ItemCountAdapterFactory.ts', added: 13, deleted: 0 }],
}

test('the band says when nothing has been scored, on every surface', async ($, on) => {
  await sessionWith($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /no scored turns yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band shows the score and state', async ($, on) => {
  await sessionWith($, on, RECORD)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /87\s+BIG BALL OF MUD/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane draws an SVG gauge on desktop and a raster on the terminal', async ($, on) => {
  await sessionWith($, on, RECORD)
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.alt)
  expect(alts).toContain('Slop score 87 of 100: BIG BALL OF MUD')
  expect(await desktop.find({ type: 'Text', text: /unavailable/ })).toBeDefined()
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Raster', key: 'gauge' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /87\/100/ })).toBeDefined()
  await terminal.unmount()
})

test('/slop explains the last turn in text, for surfaces that cannot draw', async ($, on) => {
  await sessionWith($, on, RECORD)
  const ran = await $.command.run({
    command: 'slop', args: 'explain', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
  })
  expect(ran.text).toContain('SLOP SCORE 87  BIG BALL OF MUD')
  expect(ran.text).toContain('agent churn: unavailable')
  expect(ran.text).toContain('budget 40')
})

const OTHER_BAND = {
  name: 'other-band',
  register: (on: On) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>other mod's band</Text>
    })
  },
}

test("another mod's band is preserved, not replaced", { plugins: [OTHER_BAND] }, async ($, on) => {
  await sessionWith($, on, RECORD)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /87\s+BIG BALL OF MUD/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /other mod's band/ })).toBeDefined()
    await ui.unmount()
  }
})

test('Płanetnik judges the turn beside the gauge, in the band, and on the terminal', async ($, on) => {
  await sessionWith($, on, RECORD)
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desktop.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toContain('Płanetnik: a full storm, eyes blazing')
  await desktop.unmount()
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Raster', key: 'planetnik' })).toBeDefined()
  await terminal.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Płanetnik \(╬ಠ益ಠ\)/ })).toBeDefined()
  await band.unmount()
})

test('the mascot setting turns Płanetnik off everywhere', { options: { mascot: false } }, async ($, on) => {
  await sessionWith($, on, RECORD)
  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ key: 'planetnik' })).toBeUndefined()
    expect((await pane.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))).not.toContain('Płanetnik: a full storm, eyes blazing')
    await pane.unmount()
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /Płanetnik/ })).toBeUndefined()
    await band.unmount()
  }
})

/** Writes a file through the mod's tool.call hook, as Claude's Write tool would, and returns what the model reads beside it. */
async function write($: Engine, on: On, path: string, content: string) {
  const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/${path}`, content })
  return 'context' in ran ? (ran.context ?? []) : []
}

function agentTurn(on: On) {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create', filePath: '', content: '', structuredPatch: [] } }))
}

test('the guard nudges Claude once, at the third pattern-named abstraction', async ($, on) => {
  agentTurn(on)
  await sessionWith($, on)
  await $.turn.start({ text: 'add a count endpoint', turnId: 't1' })
  expect(await write($, on, 'src/count/ItemCountService.ts', 'export class ItemCountService {}\n')).toEqual([])
  expect(await write($, on, 'src/count/ItemCountAdapter.ts', 'export class ItemCountAdapter {}\n')).toEqual([])
  const third = await write($, on, 'src/count/ItemCountAdapterFactory.ts', 'export class ItemCountAdapterFactory {}\n')
  expect(third.join('')).toContain('3 pattern-named abstractions')
  expect(await write($, on, 'src/count/ItemCountRepository.ts', 'export class ItemCountRepository {}\n')).toEqual([])
})

test('with the guard off, Claude hears nothing', { options: { guard: 'off' } }, async ($, on) => {
  agentTurn(on)
  await sessionWith($, on)
  await $.turn.start({ text: 'add a count endpoint', turnId: 't1' })
  for (const name of ['AService', 'BAdapter', 'CFactory', 'DRepository']) {
    expect(await write($, on, `src/${name}.ts`, `export class ${name} {}\n`)).toEqual([])
  }
})

test('the Simplify button sends a prompt built from what drove the score', async ($, on) => {
  let sent = ''
  on('prompt.submit', ($, e) => {
    sent = e.text
    return { text: e.text }
  })
  await sessionWith($, on, RECORD)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'simplify' })
  await pane.unmount()
  expect(sent).toContain('Simplify the change you just made')
  expect(sent).toContain('abstraction growth: 6 new abstractions')
})

test('/slop report summarises the session', async ($, on) => {
  await sessionWith($, on, { ...RECORD, at: Date.now() + 1000 })
  const ran = await $.command.run({
    command: 'slop', args: 'report', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
  })
  expect(ran.text).toContain('SLOP REPORT: this session')
  expect(ran.text).toContain('worst  87 BIG BALL OF MUD')
})

test('strict mode never fails a turn, even when its note cannot be appended', { options: { guard: 'strict', budget: 0 } }, async ($, on) => {
  // This host has no conversation store, so the note is refused here: exactly the case that must stay soft.
  // The note's text is covered in feedback.spec.ts; its delivery can only be seen in a live session.
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // A turn that changed one Python file: measurable surface, no analysis needed.
  await sessionWith($, on, undefined, '300\t0\tsrc/worker.py\0')
  await $.turn.start({ text: 'write a worker', turnId: 't1' })
  const done = await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(done.text).toBe('done')
  const explained = await $.command.run({
    command: 'slop', args: 'explain', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
  })
  expect(explained.text).toContain('over by +4')
})

test('with the guard on, Claude is briefed in a context block; with it off, not', async ($, on) => {
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await sessionWith($, on)
  const context = await $.prompt.context({ blocks: [{ name: 'currentDate', text: '2026-10-08' }] })
  const block = context.blocks.find(b => b.name === 'slopOMeter')
  expect(block?.text).toContain('Slop-O-Meter is measuring each change')
  expect(context.blocks[0]?.name).toBe('currentDate')
})

test('the guard off means no briefing', { options: { guard: 'off' } }, async ($, on) => {
  on('prompt.context', ($, e) => ({ blocks: e.blocks }))
  await sessionWith($, on)
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks.map(b => b.name)).not.toContain('slopOMeter')
})
