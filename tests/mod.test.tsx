// Mod integration tests, run by `claude plugin test` against the engine itself.
// (The pure scoring tests are tests/*.spec.ts, run by `bun test`.)

import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import type { SlopRecord } from '../types/index.d.ts'

const SURFACES = ['terminal', 'desktop'] as const
const ROOT = '/work/shop'

/**
 * A session in a repository whose stored history ends with `record`: git answers
 * the repository root, the store holds the history, and the session starts.
 */
async function sessionWith($: Engine, on: On, record?: SlopRecord) {
  on('process.run', ($, e, next) =>
    e.argv[0] === 'git' && e.argv[1] === 'rev-parse'
      ? { value: { exitCode: 0, stdout: `${ROOT}\n${ROOT}/.git\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : next(e))
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
  const svg = await desktop.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('Slop score 87 of 100: BIG BALL OF MUD')
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
