import { describe, expect, test } from 'bun:test'

import { briefing, nudgesFor, report, simplifyPrompt, strictNote } from '../src/feedback.ts'
import type { SlopRecord, SlopTurn } from '../types/index.d.ts'

const turn = (over: Partial<SlopTurn> = {}): SlopTurn => ({ baseline: 'x', edits: {}, ...over })
const klass = (name: string) => `export class ${name} {}\n`

describe('mid-turn nudges', () => {
  test('pattern-named abstractions: quiet for two, one nudge at the third, never repeated', () => {
    let t = turn()
    const write = (path: string, name: string) => {
      const out = nudgesFor(t, path, null, klass(name))
      t = { ...t, concepts: out.concepts, nudged: [...(t.nudged ?? []), ...out.nudges.map(n => n.key)] }
      return out.nudges
    }
    expect(write('src/count/ItemCountService.ts', 'ItemCountService')).toEqual([])
    expect(write('src/count/ItemCountAdapter.ts', 'ItemCountAdapter')).toEqual([])
    const third = write('src/count/ItemCountAdapterFactory.ts', 'ItemCountAdapterFactory')
    expect(third).toHaveLength(1)
    expect(third[0]!.text).toContain('ItemCountService, ItemCountAdapter, ItemCountAdapterFactory')
    expect(write('src/count/ItemCountRepository.ts', 'ItemCountRepository')).toEqual([])
  })

  test('plain names and test files are not abstraction smells', () => {
    const t = turn({ concepts: [{ name: 'AService', shape: false }, { name: 'BFactory', shape: false }] })
    expect(nudgesFor(t, 'src/search.ts', '', klass('Search')).nudges).toEqual([])
    expect(nudgesFor(t, 'tests/fakes.ts', '', klass('FakeFactory')).nudges).toEqual([])
  })

  test('an edit that weakens types says what and where', () => {
    const [n] = nudgesFor(turn(), 'src/a.ts', 'const x: number = y', 'const x: any = y as unknown as number').nudges
    expect(n!.signal).toBe('types')
    expect(n!.text).toContain('`any` and a double cast to src/a.ts')
  })

  /** Writes one declaration per file through the guard, as a turn would, and returns everything it said. */
  const declare = (decls: string[]) => {
    let t = turn()
    const said: string[] = []
    for (const decl of decls) {
      const name = decl.split(' ')[2]!
      const out = nudgesFor(t, `src/discounts/${name}.ts`, null, `${decl} { id: string }\n`)
      t = { ...t, concepts: out.concepts, nudged: [...(t.nudged ?? []), ...out.nudges.map(n => n.key)] }
      said.push(...out.nudges.map(n => n.text))
    }
    return said
  }
  const shapes = ['Discount', 'CreateDiscountInput', 'CreateDiscountResult', 'UpdateDiscountInput', 'UpdateDiscountResult',
    'ValidationResult', 'PricingResult', 'DiscountQuery', 'DiscountPage', 'AppliedDiscount', 'DiscountError', 'ExpiryWindow']

  test('six new classes of any name earn one nudge', () => {
    const said = declare(['Cart', 'Coupon', 'Ledger', 'Pricing', 'Expiry', 'Totals', 'Rounding'].map(n => `export class ${n}`))
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('6 new types and classes (Cart, Coupon')
    expect(said[0]).toContain('let TypeScript infer the rest')
  })

  test('data shapes count half: seven interfaces pass, the twelfth is sprawl', () => {
    expect(declare(shapes.slice(0, 7).map(n => `export interface ${n}`))).toEqual([])
    const said = declare(shapes.map(n => `export interface ${n}`))
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('12 new types and classes')
  })

  test('validators and calculators count as pattern names now', () => {
    const out = nudgesFor(turn({ concepts: [{ name: 'DiscountValidator', shape: false }, { name: 'DiscountCalculator', shape: false }] }), 'src/d/DiscountService.ts', null, klass('DiscountService'))
    expect(out.nudges.map(n => n.signal)).toEqual(['abstractions'])
  })

  test('type weakening is flagged per file, up to three files a turn', () => {
    let t = turn()
    const flagged: string[] = []
    for (const f of ['a', 'b', 'c', 'd']) {
      const out = nudgesFor(t, `src/${f}.ts`, 'const x = 1', 'const x: any = 1')
      t = { ...t, nudged: [...(t.nudged ?? []), ...out.nudges.map(n => n.key)] }
      flagged.push(...out.nudges.map(n => n.key))
    }
    expect(flagged).toEqual(['types:src/a.ts', 'types:src/b.ts', 'types:src/c.ts'])
  })

  test('the second unrequested new document is sprawl; requested or edited ones are not', () => {
    const first = nudgesFor(turn({ request: 'add discount codes' }), 'ARCHITECTURE.md', null, '# arch')
    expect(first.nudges).toEqual([])
    const second = nudgesFor(turn({ request: 'add discount codes', docs: first.docs }), 'QUICKSTART.md', null, '# quick')
    expect(second.nudges.map(n => n.text).join('')).toContain('2 new Markdown files (ARCHITECTURE.md, QUICKSTART.md)')
    expect(nudgesFor(turn({ request: 'document the discount API', docs: ['A.md'] }), 'B.md', null, '#').nudges).toEqual([])
    expect(nudgesFor(turn({ request: 'x', docs: ['A.md'] }), 'README.md', '# old', '# new').nudges).toEqual([])
  })

  test('the fifth edit to one file asks for one approach', () => {
    const t = turn({ edits: { 'src/money.ts': { ops: 5, added: 90, deleted: 60 } } })
    expect(nudgesFor(t, 'src/money.ts', 'a', 'b').nudges.map(n => n.signal)).toEqual(['churn'])
    expect(nudgesFor(turn({ edits: { 'src/money.ts': { ops: 4, added: 9, deleted: 6 } } }), 'src/money.ts', 'a', 'b').nudges).toEqual([])
  })
})

const RECORD: SlopRecord = {
  at: Date.UTC(2026, 9, 7, 14, 2),
  score: 73,
  state: 'HEAVY SLOP',
  delta: 60,
  components: [
    { key: 'abstractions', label: 'abstraction growth', weight: 15, normalized: 1, contribution: 25, raw: {}, reason: '6 new abstractions', subjects: ['ItemCountAdapter', 'ItemCountResponseWrapper'] },
    { key: 'amplification', label: 'change amplification', weight: 15, normalized: 1, contribution: 24, raw: {}, reason: '14.5 units of machinery for ~3 of behaviour' },
    { key: 'surface', label: 'change surface', weight: 15, normalized: 0.4, contribution: 10, raw: {}, reason: '7 files' },
    { key: 'tests', label: 'test/risk modifier', weight: 0, normalized: 0, contribution: 0, raw: {}, reason: '' },
  ],
  changes: [],
  nudges: ['abstractions'],
}

describe('strict mode', () => {
  test('says nothing within budget', () => {
    expect(strictNote({ ...RECORD, score: 30 }, 40)).toBeNull()
  })

  test('names the score, the budget and what drove it', () => {
    const note = strictNote(RECORD, 40)!
    expect(note).toContain('scored 73 (HEAVY SLOP), over the budget of 40')
    expect(note).toContain('abstraction growth: 6 new abstractions')
    expect(note).toContain('does not affect the score')
  })
})

describe('the Simplify prompt', () => {
  test('points at the drivers and the names behind them', () => {
    const prompt = simplifyPrompt(RECORD)
    expect(prompt).toContain('scored it 73 (HEAVY SLOP)')
    expect(prompt).toContain('- change amplification: 14.5 units')
    expect(prompt).toContain('Look first at: ItemCountAdapter, ItemCountResponseWrapper.')
    expect(prompt).toContain('Do not introduce new abstractions.')
    expect(prompt).not.toContain('test/risk')
  })
})

describe('the session report', () => {
  test('is honest about an empty session', () => {
    expect(report([], 40)).toContain('no scored turns this session')
  })

  test('summarises turns, the worst, the best simplification and the guard', () => {
    const later = { ...RECORD, at: RECORD.at + 60_000, score: 13, state: 'CLEAN' as const, delta: -60, nudges: [] }
    const text = report([{ ...RECORD, score: 13, delta: null, nudges: [] }, RECORD, later], 40)
    expect(text).toContain('turns scored 3   average 33   median 13   over budget (40) 1')
    expect(text).toContain('worst  73 HEAVY SLOP')
    expect(text).toContain('best simplification  -60 to 13')
    expect(text).toContain('trend  13 → 73 → 13')
    expect(text).toContain('guard nudges  1 (abstractions 1)')
  })
})

describe('the briefing', () => {
  test('says what is measured, the budget, and not to game it', () => {
    const text = briefing(40)
    expect(text).toContain('Budget: 40 per turn')
    expect(text).toContain('new documentation files the request did not ask for')
    expect(text).toContain('let TypeScript infer the rest: a declared type for every input and result is sprawl')
    expect(text).toContain('Never cut requested scope, tests or correctness to lower the score.')
  })
})
