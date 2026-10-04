import { describe, expect, test } from 'bun:test'

import { analyze, lex } from '../src/analyze.ts'

describe('lex', () => {
  test('strings, templates, comments and regex do not leak tokens', () => {
    const kinds = lex('const a = "if (x) {" + `${b ? "}" : 1} if` // if {\nconst r = /if{[/]/g')
      .map(t => t.kind)
    expect(kinds).toEqual(['word', 'word', 'punct', 'str', 'punct', 'str', 'comment', 'word', 'word', 'punct', 'regex'])
  })

  test('division is not a regex', () => {
    expect(lex('a / b / c').map(t => t.kind)).toEqual(['word', 'punct', 'word', 'punct', 'word'])
  })

  test('an apostrophe in JSX text stays on its line', () => {
    const tokens = lex("<Text>don't</Text>\nif (x) {}")
    expect(tokens.find(t => t.text === 'if')?.line).toBe(2)
  })

  test('tracks lines through block comments and templates', () => {
    const tokens = lex('/*\n\n*/ `a\nb` x')
    expect(tokens.at(-1)).toEqual({ kind: 'word', text: 'x', line: 4 })
  })
})

describe('analyze', () => {
  test('flat code < nested code, in cognitive complexity', () => {
    const flat = analyze('function f(a) {\n if (a) return 1\n if (b) return 2\n return 3\n}')
    const nested = analyze('function f(a) {\n if (a) {\n  for (const x of a) {\n   if (x) { while (y) {} }\n  }\n }\n}')
    expect(flat.cognitive).toBeLessThan(nested.cognitive)
    expect(nested.maxNesting).toBe(4)
    expect(flat.branches).toBe(2)
  })

  test('counts logical operators and ternaries, not optional syntax', () => {
    const f = analyze('const x = a && b || c ?? d\nconst y = p ? 1 : 2\nfunction g(o?: T) { return o?.v }')
    expect(f.branches).toBe(4)
  })

  test('declarations at the top level, exported or not', () => {
    const f = analyze(`
export interface SearchRepository { find(q: string): Item[] }
export class SearchService implements SearchRepository { find(q: string) { return [] } }
type Q = string
enum Mode { A }
export const make = (x: number) => x
const helper = async () => 1
function plain() {}
const value = 3
`)
    expect(f.declarations.map(d => `${d.kind} ${d.name} ${d.exported}`)).toEqual([
      'interface SearchRepository true',
      'class SearchService true',
      'type Q false',
      'enum Mode false',
      'function make true',
      'function helper false',
      'function plain false',
    ])
  })

  test('function lengths, including annotated return types', () => {
    const f = analyze('function a(): number {\n return 1\n}\nconst b = () => {\n\n}\nclass C { m(x: T): void {\n} }')
    expect(f.functionLengths.sort()).toEqual([2, 3, 3])
  })

  test('type weakening', () => {
    const f = analyze(`
import { a as b } from 'x'
// @ts-ignore
const x: any = y as unknown as Z
const z = q as const
const w = maybe!.value
const s = a !== b
`)
    expect(f.any).toBe(1)
    expect(f.casts).toBe(2)
    expect(f.doubleCasts).toBe(1)
    expect(f.suppressions).toBe(1)
    expect(f.nonNull).toBe(1)
  })

  test('restating comments, not useful ones', () => {
    const f = analyze(`
// increment the counter
counter++
// Users may retry within the grace window, so keep the token alive.
renew(token)
`)
    expect(f.restating).toBe(1)
  })

  test('tests, skipped tests and assertions', () => {
    const f = analyze(`
test('a', () => { expect(1).toBe(1) })
it('b', () => { expect(2).toBe(2) })
it.skip('c', () => {})
xdescribe('d', () => {})
`)
    expect(f.testCases).toBe(2)
    expect(f.skippedTests).toBe(2)
    expect(f.assertions).toBe(2)
  })

  test('shapes erase names so renamed copies match', () => {
    const a = analyze('const total = items.reduce((n, i) => n + i.price, 0)')
    const b = analyze('const sum = rows.reduce((acc, r) => acc + r.cost, 0)')
    expect(a.shapes).toEqual(b.shapes)
  })
})

describe('doc comments', () => {
  test('a doc block that only names the code is restating; one that explains is not', () => {
    const f = analyze(`
/**
 * Builds search queries.
 */
export class SearchQueryBuilder {}

/** A quote never spans lines, so a stray apostrophe damages one line at most. */
function scanQuote() {}
`)
    expect(f.restating).toBe(1)
    expect(f.docBlocks).toBe(2)
  })
})
