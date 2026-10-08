import { describe, expect, test } from 'bun:test'

import { cleanStreak, isSunbreak, milestonesIn, verdict, weather } from '../src/delight.ts'
import { stateOf } from '../src/score.ts'
import type { SlopComponent, SlopRecord } from '../types/index.d.ts'

const part = (key: string, contribution: number, raw: Record<string, number> = {}): SlopComponent =>
  ({ key, label: key, weight: 15, normalized: 0.5, contribution, raw, reason: '' })

let clock = 0
const turn = (score: number, delta: number | null, components: SlopComponent[] = [], changes: SlopRecord['changes'] = []): SlopRecord =>
  ({ at: (clock += 1000), score, state: stateOf(score), delta, components, changes })

describe('Płanetnik’s verdict', () => {
  test('speaks to the biggest driver, with its numbers', () => {
    const r = turn(55, 10, [part('surface', 6, { files: 9 }), part('abstractions', 20, { added: 6, singleUse: 4 })])
    expect(verdict(r, [r])).toBe('6 new abstractions, 4 with one consumer. The clouds gather.')
  })

  test('cries storm at Big Ball of Mud', () => {
    const r = turn(90, 20, [part('docs', 30, { newDocs: 4 })])
    expect(verdict(r, [r])).toBe('Burza! 4 documents nobody asked for. Put it in your reply.')
  })

  test('is calm when clean, and counts a clean streak', () => {
    const history = [turn(10, null), turn(8, -2), turn(12, 4)]
    expect(verdict(history[0]!, history.slice(0, 1))).toMatch(/Clear skies\.|Calm weather|Not a cloud/)
    expect(verdict(history[2]!, history)).toBe('Clear skies, 3 turns running.')
  })

  test('is the same every time for the same turn', () => {
    const r = turn(12, null)
    expect(verdict(r, [r])).toBe(verdict(r, [r]))
  })

  test('greets a Sunbreak', () => {
    const r = turn(14, -58)
    expect(verdict(r, [r])).toBe('The sun breaks through. 72 down to 14. Well simplified.')
  })
})

describe('Sunbreak', () => {
  test('needs a climb out of the red of 30 or more, to Mild Slop or better', () => {
    expect(isSunbreak(turn(14, -58))).toBe(true)
    expect(isSunbreak(turn(40, -30))).toBe(true)
    expect(isSunbreak(turn(45, -40))).toBe(false)
    expect(isSunbreak(turn(30, -25))).toBe(false)
    expect(isSunbreak(turn(10, -30))).toBe(false)
    expect(isSunbreak(turn(10, null))).toBe(false)
  })
})

describe('forecast', () => {
  test('weather for every state', () => {
    expect([5, 30, 50, 70, 90].map(weather).join('')).toBe('☀☁☂ϟϟ')
  })

  test('the clean streak runs back from the latest turn', () => {
    expect(cleanStreak([turn(70, null), turn(10, -60), turn(12, 2)])).toBe(2)
    expect(cleanStreak([turn(10, null), turn(50, 40)])).toBe(0)
  })
})

describe('milestones', () => {
  const clean = (n: number) => Array.from({ length: n }, () => turn(10, 0, [part('typeWeakening', 0, { any: 0 })]))

  test('nothing for an ordinary afternoon', () => {
    expect(milestonesIn([turn(30, null), turn(25, -5)])).toEqual([])
  })

  test('first storm survived: a heavy turn, then a mild one', () => {
    expect(milestonesIn([turn(70, null), turn(45, -25)])).toEqual([])
    expect(milestonesIn([turn(70, null), turn(45, -25), turn(35, -10)])).toContain('storm')
  })

  test('clear skies after ten clean turns in a row', () => {
    expect(milestonesIn(clean(9))).not.toContain('clear')
    expect(milestonesIn(clean(10))).toContain('clear')
  })

  test('sunbreak, and no `any` for twenty turns', () => {
    expect(milestonesIn([turn(72, null), turn(14, -58)])).toContain('sunbreak')
    const any = turn(10, 0, [part('typeWeakening', 3, { any: 1 })])
    expect(milestonesIn([...clean(19), any])).not.toContain('no-any')
    expect(milestonesIn(clean(20))).toContain('no-any')
  })

  test('net negative: a clean turn that deleted more than it added', () => {
    expect(milestonesIn([turn(10, null, [], [{ path: 'src/a.ts', added: 3, deleted: 40 }])])).toContain('net-negative')
    expect(milestonesIn([turn(10, null, [], [{ path: 'src/a.ts', added: 30, deleted: 40 }])])).toContain('net-negative')
    expect(milestonesIn([turn(10, null, [], [{ path: 'src/a.ts', added: 3, deleted: 5 }])])).not.toContain('net-negative')
  })
})
