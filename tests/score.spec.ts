import { describe, expect, test } from 'bun:test'

import { churn, combine, docSprawl, lineDiff, saturate, scoreTurn, stateOf, surface } from '../src/score.ts'

const change = (path: string, added: number, deleted = 0) => ({ path, added, deleted })

describe('states', () => {
  test('every threshold maps to its state', () => {
    expect(stateOf(0)).toBe('CLEAN')
    expect(stateOf(20)).toBe('CLEAN')
    expect(stateOf(21)).toBe('MILD SLOP')
    expect(stateOf(40)).toBe('MILD SLOP')
    expect(stateOf(60)).toBe('GETTING SLOPPY')
    expect(stateOf(80)).toBe('HEAVY SLOP')
    expect(stateOf(81)).toBe('BIG BALL OF MUD')
    expect(stateOf(100)).toBe('BIG BALL OF MUD')
  })
})

describe('saturate', () => {
  test('is 0 at 0, monotonic, below 1', () => {
    expect(saturate(0, 5)).toBe(0)
    expect(saturate(-3, 5)).toBe(0)
    expect(saturate(10, 5)).toBeGreaterThan(saturate(5, 5))
    expect(saturate(1000, 5)).toBeLessThanOrEqual(1)
  })
})

describe('lineDiff', () => {
  test('counts only changed lines, like git', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, deleted: 1 })
    expect(lineDiff('', 'a\nb\n')).toEqual({ added: 2, deleted: 0 })
    expect(lineDiff('a\nb', '')).toEqual({ added: 0, deleted: 2 })
    expect(lineDiff('a\nb\nc', 'a\nx\nb\nc')).toEqual({ added: 1, deleted: 0 })
  })
})

describe('surface', () => {
  test('one file < many files across directories', () => {
    const small = surface([change('src/a.ts', 10)])
    const wide = surface([
      change('src/a.ts', 10), change('src/b/x.ts', 10), change('lib/c.ts', 10),
      change('api/d.ts', 10), change('svc/e.ts', 10), change('svc/f.ts', 10),
    ])
    expect(small.normalized!).toBeLessThan(wide.normalized!)
  })

  test('tests, docs and lockfiles are not production surface', () => {
    const s = surface([change('README.md', 50), change('tests/a.test.ts', 80), change('bun.lock', 900)])
    expect(s.raw.files).toBe(0)
    expect(s.normalized).toBe(0)
  })

  test('files that only lost lines do not spread a change', () => {
    const s = surface([change('src/a.ts', 3), change('src/old/x.ts', 0, 40), change('src/old/y.ts', 0, 30)])
    expect(s.raw.files).toBe(1)
    expect(s.normalized!).toBeLessThan(0.05)
  })

  test('the same edit repeated across files counts once', () => {
    const before = (name: string) => `import { log } from '../log'\nlog('${name} ' + id)\n`
    const after = (name: string) => `import { logEvent } from '../log'\nlogEvent('${name}', { id })\n`
    const paths = ['src/a/x.ts', 'src/b/y.ts', 'src/c/z.ts', 'src/d/w.ts']
    const s = surface(paths.map(p => change(p, 2, 2)),
      paths.map(p => ({ path: p, before: before(p), after: after(p) })))
    expect(s.raw.distinctChanges).toBe(1)
    expect(s.raw.repeated).toBe(3)
    expect(s.normalized!).toBeLessThan(surface(paths.map(p => change(p, 2, 2))).normalized!)
  })

  test('raw size alone does not dominate', () => {
    const big = surface([change('src/a.ts', 2000, 1500)])
    expect(big.normalized!).toBeLessThan(0.3)
  })
})

describe('churn', () => {
  test('is unavailable without edit-tool activity', () => {
    expect(churn([change('a.ts', 5)], {}).normalized).toBeNull()
  })

  test('sensible iteration < rewrite-heavy turn', () => {
    const final = [change('src/a.ts', 30, 10)]
    const sensible = churn(final, { 'src/a.ts': { ops: 3, added: 40, deleted: 15 } })
    const heavy = churn(final, { 'src/a.ts': { ops: 14, added: 450, deleted: 250 } })
    expect(sensible.normalized!).toBeLessThan(0.15)
    expect(heavy.normalized!).toBeGreaterThan(0.6)
  })

  test('700 lines written for a 40-line diff is high churn', () => {
    const c = churn([change('src/a.ts', 30, 10)], { 'src/a.ts': { ops: 9, added: 450, deleted: 250 } })
    expect(c.normalized!).toBeGreaterThan(0.8)
    expect(c.reason).toContain('94%')
  })

  test('lines added in one file do not hide waste in another', () => {
    const c = churn([change('src/a.ts', 300), change('src/b.ts', 20)], {
      'src/a.ts': { ops: 1, added: 20, deleted: 0 },
      'src/b.ts': { ops: 5, added: 400, deleted: 380 },
    })
    expect(c.raw.wasted).toBe(760)
    expect(c.normalized!).toBeGreaterThan(0.8)
  })

  test('files edited then reverted count as abandoned', () => {
    const c = churn([change('src/a.ts', 5)], {
      'src/a.ts': { ops: 1, added: 5, deleted: 0 },
      'src/helper.ts': { ops: 2, added: 60, deleted: 0 },
    })
    expect(c.raw.abandoned).toBe(1)
  })
})

describe('combine', () => {
  const metric = (key: string, normalized: number | null, weight = 15) =>
    ({ key, label: key, weight, normalized, contribution: 0, raw: {}, reason: '' })

  test('unavailable metrics neither add nor dilute', () => {
    expect(combine([metric('a', 0.5), metric('b', null)]).score).toBe(combine([metric('a', 0.5)]).score)
  })

  test('agreeing signals outweigh either alone', () => {
    const one = combine([metric('a', 1), metric('b', 0)]).score
    const both = combine([metric('a', 1), metric('b', 1)]).score
    expect(both).toBeGreaterThan(one)
    expect(both).toBeLessThan(2 * one)
  })

  test('contributions add up to the score', () => {
    const s = combine([metric('a', 0.8), metric('b', 0.3), metric('c', -0.4, 5)])
    expect(Math.round(s.components.reduce((n, c) => n + c.contribution, 0))).toBe(s.score)
  })

  test('score is clamped to 0..100', () => {
    expect(combine(Array.from({ length: 20 }, (_, i) => metric(`m${i}`, 1))).score).toBeLessThanOrEqual(100)
    expect(combine([metric('a', -0.5)]).score).toBe(0)
  })
})

describe('scoreTurn', () => {
  test('tiny direct fix < wide churny change', () => {
    const tiny = scoreTurn({
      changes: [change('src/a.ts', 2, 1)],
      edits: { 'src/a.ts': { ops: 1, added: 2, deleted: 1 } },
    })
    const sloppy = scoreTurn({
      changes: ['a', 'b/c', 'd/e', 'f/g', 'h/i', 'j/k', 'l/m'].map(p => change(`src/${p}.ts`, 40)),
      edits: { 'src/a.ts': { ops: 12, added: 600, deleted: 400 } },
    })
    expect(tiny.score).toBeLessThan(sloppy.score)
    expect(tiny.state).toBe('CLEAN')
  })
})

describe('comment noise', () => {
  test('deleting code elsewhere does not make new comments excessive', () => {
    const code = 'export function f(a: number) {\n  return a + 1\n}\n'.repeat(10)
    const commented = '// why this exists, in a sentence\n' + code
    const s = scoreTurn({
      changes: [{ path: 'src/a.ts', added: 1, deleted: 0 }, { path: 'src/old.ts', added: 0, deleted: 30 }],
      edits: {},
      files: [
        { path: 'src/a.ts', before: code, after: commented },
        { path: 'src/old.ts', before: code, after: null },
      ],
    })
    expect(s.components.find(c => c.key === 'comments')!.normalized).toBe(0)
  })
})

describe('documentation sprawl', () => {
  const doc = (path: string, added = 80) => ({ path, added, deleted: 0, isNew: true })

  test('one new document is fine; three unrequested ones are sprawl, named', () => {
    expect(docSprawl([doc('NOTES.md')], 'add discounts').normalized).toBe(0)
    const s = docSprawl([doc('ARCHITECTURE.md'), doc('QUICKSTART.md'), doc('IMPLEMENTATION_SUMMARY.md')], 'add discounts')
    expect(s.normalized!).toBeGreaterThan(0.6)
    expect(s.reason).toContain('3 new Markdown files nobody asked for (ARCHITECTURE.md, QUICKSTART.md, IMPLEMENTATION_SUMMARY.md)')
  })

  test('documents the request asked for are the work, not sprawl', () => {
    const s = docSprawl([doc('docs/api.md'), doc('docs/setup.md'), doc('README.md')], 'Write documentation for the API')
    expect(s.normalized).toBe(0)
    expect(s.reason).toBe('documentation was requested')
  })

  test('editing existing documents is not sprawl', () => {
    expect(docSprawl([{ path: 'README.md', added: 40, deleted: 2 }, { path: 'CHANGELOG.md', added: 5, deleted: 0 }], 'x').normalized).toBe(0)
  })
})
