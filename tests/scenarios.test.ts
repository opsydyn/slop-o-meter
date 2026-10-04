import { describe, expect, test } from 'bun:test'

import { lineDiff, scoreTurn, type Scored } from '../src/score.ts'
import * as S from './fixtures/scenarios.ts'

/** Scores a scenario as if an agent wrote it in one clean pass (no churn). */
function score({ before, after }: S.Scenario): Scored {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const files = paths
    .map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }))
    .filter(f => f.before !== f.after)
  const changes = files.map(f => ({ path: f.path, ...lineDiff(f.before ?? '', f.after ?? '') }))
  const edits = Object.fromEntries(changes.map(c => [c.path, { ops: 1, added: c.added, deleted: c.deleted }]))
  return scoreTurn({ changes, edits, files })
}

const scores = Object.fromEntries(Object.entries(S).map(([name, s]) => [name, score(s)]))
const of = (name: keyof typeof S) => scores[name]!.score
const part = (name: keyof typeof S, key: string) =>
  scores[name]!.components.find(c => c.key === key)!.contribution

test('scenario scores (for calibration, not asserted)', () => {
  for (const [name, s] of Object.entries(scores)) {
    console.log(`${String(s.score).padStart(3)}  ${s.state.padEnd(16)} ${name}  ` +
      s.components.filter(c => c.contribution !== 0).map(c => `${c.key}:${Math.round(c.contribution)}`).join(' '))
  }
})

describe('ordering', () => {
  test('direct < normal < over-engineered', () => {
    expect(of('direct')).toBeLessThan(of('normal'))
    expect(of('normal')).toBeLessThan(of('overEngineered'))
  })

  test('the direct fix is clean, the over-engineered one is heavy', () => {
    expect(scores.direct!.state).toBe('CLEAN')
    expect(of('overEngineered')).toBeGreaterThan(60)
  })

  test('over-engineering is explained by abstractions and amplification', () => {
    expect(part('overEngineered', 'abstractions')).toBeGreaterThan(part('direct', 'abstractions'))
    expect(part('overEngineered', 'amplification')).toBeGreaterThan(5)
  })

  test('simplifying the over-engineered version scores below it', () => {
    expect(of('simplification')).toBeLessThan(of('overEngineered'))
    expect(part('simplification', 'abstractions')).toBeLessThan(0)
  })

  test('a large coherent refactor is not a Big Ball of Mud', () => {
    expect(scores.largeRefactor!.state).not.toBe('BIG BALL OF MUD')
    expect(of('largeRefactor')).toBeLessThan(of('overEngineered'))
  })

  test('a minimal fix in legacy code is not punished for the legacy', () => {
    expect(of('legacyFix')).toBeLessThanOrEqual(20)
  })

  test('tests reduce the risk of the same change, but only a little', () => {
    expect(of('testedRisk')).toBeLessThan(of('untestedRisk'))
    expect(of('untestedRisk') - of('testedRisk')).toBeLessThanOrEqual(8)
  })

  test('strong typing < introduced any', () => {
    expect(of('direct')).toBeLessThan(of('weakTyping'))
  })

  test('no new dependency < unnecessary dependency', () => {
    expect(of('direct')).toBeLessThan(of('needlessDependency'))
  })
})
