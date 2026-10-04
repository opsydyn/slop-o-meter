// The Slop Score: raw metrics in, a 0–100 score and its reasons out.
// Pure: no Claude Code, no git, so it can be tested on its own.

import type {
  SlopComponent as Component,
  SlopEditActivity as EditActivity,
  SlopFileChange as FileChange,
  SlopState as State,
} from '../types/index.d.ts'
import { analyze, ANALYZABLE, editShape, type Declaration, type Facts } from './analyze.ts'

/** A changed file's text before and after the turn; null where it did not exist. */
export type FileVersion = { path: string; before: string | null; after: string | null }

export type TurnInput = {
  /** The turn's net change: baseline tree versus final tree. */
  changes: FileChange[]
  edits: EditActivity
  /** Contents of the changed source files and package.json files. */
  files?: FileVersion[]
}

export type Scored = { score: number; state: State; components: Component[] }

export const WEIGHTS = {
  surface: 15,
  complexity: 15,
  abstractions: 15,
  amplification: 15,
  churn: 15,
  typeWeakening: 10,
  dependencies: 5,
  duplication: 5,
  comments: 5,
}

const STATES: [number, State][] = [
  [20, 'CLEAN'],
  [40, 'MILD SLOP'],
  [60, 'GETTING SLOPPY'],
  [80, 'HEAVY SLOP'],
]

export function stateOf(score: number): State {
  return STATES.find(([max]) => score <= max)?.[1] ?? 'BIG BALL OF MUD'
}

/** 0 at x=0, rising toward 1; `k` is where it reaches ~63%. */
export const saturate = (x: number, k: number) => (x <= 0 ? 0 : 1 - Math.exp(-x / k))

const LOCKFILE = /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$/
const TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const DOC = /\.(md|mdx|txt|rst)$/i

export const isTest = (path: string) => TEST.test(path)
export const isProduction = (path: string) =>
  !LOCKFILE.test(path) && !isTest(path) && !DOC.test(path)

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/') || '.'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * How widely the change spreads. Files that only lost lines do not spread it,
 * and files that received the same edit (a rename, a signature change) count
 * as one change, however many there are.
 */
export function surface(changes: FileChange[], files: FileVersion[] = []): Component {
  const content = new Map(files.map(f => [f.path, f]))
  const grown = changes.filter(c => isProduction(c.path) && c.added > 0)
  const groups = new Map<string, FileChange[]>()
  for (const c of grown) {
    const f = content.get(c.path)
    const shape = f?.before && f.after ? editShape(f.before, f.after) : c.path
    groups.set(shape, [...(groups.get(shape) ?? []), c])
  }
  const distinct = [...groups.values()].map(group => group[0]!)
  const repeated = grown.length - distinct.length
  const filesN = distinct.length
  const dirs = new Set(distinct.map(c => dirOf(c.path))).size
  const lines = changes.filter(c => isProduction(c.path)).reduce((n, c) => n + c.added + 0.25 * c.deleted, 0)
  const normalized =
    0.45 * saturate(filesN - 1, 5) + 0.35 * saturate(dirs - 1, 3) + 0.2 * saturate(lines, 400)
  const spread = new Set(grown.map(c => dirOf(c.path))).size
  const parts = [`${plural(grown.length, 'production file')} grew across ${spread} director${spread === 1 ? 'y' : 'ies'}, ${Math.round(lines)} lines`]
  if (repeated > 0) parts.push(`${repeated} repeat the same edit`)
  return component('surface', 'change surface', normalized,
    { files: grown.length, distinctChanges: filesN, dirs, lines: Math.round(lines), repeated },
    grown.length === 0 ? 'no production code added' : parts.join('; '))
}

/**
 * Edit volume the agent's tools performed versus what survived in the final
 * diff, file by file: lines added elsewhere (or through a shell) cannot hide
 * work that was thrown away in another file.
 */
export function churn(changes: FileChange[], edits: EditActivity): Component {
  const finalOf = new Map(changes.map(c => [c.path, c.added + c.deleted]))
  const files = Object.entries(edits)
  const volume = files.reduce((n, [, e]) => n + e.added + e.deleted, 0)
  const ops = files.reduce((n, [, e]) => n + e.ops, 0)
  if (volume === 0) {
    return component('churn', 'agent churn', null, { volume, ops }, 'no edit-tool activity observed')
  }
  const wasted = files.reduce((n, [path, e]) => n + Math.max(0, e.added + e.deleted - (finalOf.get(path) ?? 0)), 0)
  const survival = 1 - wasted / volume
  const abandoned = files.filter(([path]) => !finalOf.has(path)).length
  const rewritten = files.filter(([, e]) => e.ops >= 6).length
  const normalized = saturate(wasted, 80) * Math.sqrt(1 - survival)
  const parts = [`${Math.round((1 - survival) * 100)}% of ${volume} edited lines did not survive`]
  if (abandoned) parts.push(`${plural(abandoned, 'file')} edited then reverted or deleted`)
  if (rewritten) parts.push(`${plural(rewritten, 'file')} edited 6+ times`)
  return component('churn', 'agent churn', normalized,
    { volume, wasted, ops, survival: round(survival), abandoned, rewritten }, parts.join('; '))
}

function component(
  key: keyof typeof WEIGHTS,
  label: string,
  normalized: number | null,
  raw: Record<string, number>,
  reason: string,
): Component {
  const weight = WEIGHTS[key]
  // Below zero only for metrics that reward simplification, and by at most half a weight.
  const n = normalized === null ? null : round(Math.min(1, Math.max(-0.5, normalized)))
  return { key, label, weight, normalized: n, contribution: 0, raw, reason }
}

const round = (x: number) => Math.round(x * 1000) / 1000

/** How far one maxed-out metric moves the score alone: weight 15 → 37 points. */
const EVIDENCE = 2.5

/**
 * Each metric is independent evidence of slop: strengths combine as
 * 1 − Π(1 − s), so one strong signal reads as concerning and agreement between
 * signals pushes toward mud, while quiet or unavailable metrics dilute nothing.
 * The total is split back across the metrics in proportion to their evidence,
 * so the contributions still add up to the score. Reductions (simplification)
 * subtract up to half their weight, and a weightless component is a bounded
 * modifier whose contribution is fixed points, added as given.
 */
export function combine(components: Component[]): Scored {
  const evidence = (c: Component) =>
    c.weight > 0 && c.normalized !== null && c.normalized > 0
      ? -Math.log(1 - Math.min(0.95, (c.weight / 100) * EVIDENCE * c.normalized))
      : 0
  const total = components.reduce((n, c) => n + evidence(c), 0)
  const slop = 100 * (1 - Math.exp(-total))
  const scaled = components.map(c => ({
    ...c,
    contribution: round(
      c.weight === 0 ? c.contribution
      : c.normalized === null ? 0
      : c.normalized < 0 ? c.weight * c.normalized
      : total === 0 ? 0 : (slop * evidence(c)) / total,
    ),
  }))
  const score = Math.round(Math.min(100, Math.max(0, scaled.reduce((n, c) => n + c.contribution, 0))))
  return { score, state: stateOf(score), components: scaled }
}

export function scoreTurn({ changes, edits, files = [] }: TurnInput): Scored {
  const code = pairs(files)
  const prodChanged = changes.some(c => isProduction(c.path) && !/(^|\/)package\.json$/.test(c.path))
  // Language metrics are unavailable when production code changed but none of it could be read.
  const measurable = !prodChanged || code.some(p => !p.isTest)
  return combine([
    surface(changes, files),
    churn(changes, edits),
    complexity(code, measurable),
    abstractions(code, measurable),
    amplification(code, measurable),
    typeWeakening(code, measurable),
    dependencies(files),
    duplication(code, measurable),
    comments(code, measurable),
    tests(code, measurable),
  ])
}

type Pair = { path: string; before: Facts; after: Facts; isNew: boolean; isGone: boolean; isTest: boolean }

const EMPTY = analyze('')

function pairs(files: FileVersion[]): Pair[] {
  return files
    .filter(f => ANALYZABLE.test(f.path))
    .map(f => ({
      path: f.path,
      before: f.before === null ? EMPTY : analyze(f.before),
      after: f.after === null ? EMPTY : analyze(f.after),
      isNew: f.before === null,
      isGone: f.after === null,
      isTest: isTest(f.path),
    }))
}

const sum = (ps: Pair[], get: (f: Facts) => number) =>
  ps.reduce((n, p) => n + get(p.after) - get(p.before), 0)

/** Positive evidence saturates toward 1; reductions earn up to −0.5. */
const signed = (x: number, k: number) => (x >= 0 ? saturate(x, k) : -0.5 * saturate(-x, k))

const prodOf = (code: Pair[]) => code.filter(p => !p.isTest)

export function complexity(code: Pair[], measurable: boolean): Component {
  const prod = prodOf(code)
  const cognitive = sum(prod, f => f.cognitive)
  const lines = Math.max(10, sum(prod, f => f.codeLines))
  // Size alone is not slop: judge how dense the new control flow is, and
  // structure no reviewer wants (nesting past 3 levels, functions over 60 lines).
  const density = cognitive / lines
  const nesting = Math.max(0, ...prod.map(p => p.after.maxNesting - Math.max(3, p.before.maxNesting)))
  const long = (f: Facts) => f.functionLengths.filter(n => n > 60).length
  const longFns = Math.max(0, sum(prod, long))
  const structure = 0.5 * saturate(nesting, 2) + 0.5 * saturate(longFns, 2)
  const normalized = cognitive <= 0 && structure === 0
    ? signed(cognitive, 30)
    : 0.55 * saturate(cognitive, 20) * saturate(density - 0.15, 0.35) + 0.45 * structure
  const parts = [`cognitive complexity ${cognitive >= 0 ? '+' : ''}${cognitive} (${round(density)} per new line)`]
  if (nesting > 0) parts.push(`nesting ${nesting} past 3 levels`)
  if (longFns > 0) parts.push(`${plural(longFns, 'function')} over 60 lines`)
  return component('complexity', 'complexity delta', measurable ? normalized : null,
    { cognitive, density: round(density), nesting, longFunctions: longFns, branches: sum(prod, f => f.branches) }, parts.join(', '))
}

/** Rough units of behaviour a change adds: decisions, tested cases, and logic volume. */
function behaviourOf(code: Pair[]): number {
  const prod = prodOf(code)
  const branches = Math.max(0, sum(prod, f => f.branches))
  const newTests = Math.max(0, sum(code.filter(p => p.isTest), f => f.testCases))
  const lines = Math.max(0, sum(prod, f => f.codeLines))
  return Math.max(1, branches + newTests + lines / 25)
}

const PATTERN = /(Factory|Service|Repository|Repo|Adapter|Wrapper|Manager|Provider|Handler|Builder|Strategy|Helper|Helpers|Util|Utils|Base|Abstract|Impl|Interface|Config|Facade|Proxy|Registry|Orchestrator|Coordinator)$/
const WEIGHT_OF = { class: 1, interface: 1, enum: 1, type: 0.5 }
type Concept = { name: string; kind: keyof typeof WEIGHT_OF; exported: boolean; consumers: number }

/**
 * New top-level concepts (classes, interfaces, enums, types) in production code,
 * and their consumers: the other production files that name them, plus the
 * declaring file when it uses the name itself.
 */
function newConcepts(code: Pair[]) {
  const prod = prodOf(code)
  const key = (d: { kind: string; name: string }) => `${d.kind} ${d.name}`
  const isConcept = (d: Declaration): d is Declaration & { kind: Concept['kind'] } => d.kind !== 'function'
  const consumers = (name: string, home: Pair) =>
    prod.filter(p => p !== home && p.after.uses.has(name)).length + ((home.after.uses.get(name) ?? 0) > 1 ? 1 : 0)
  const added: Concept[] = prod.flatMap(p => {
    const had = new Set(p.before.declarations.map(key))
    return p.after.declarations.filter(isConcept).filter(d => !had.has(key(d)))
      .map(d => ({ ...d, consumers: consumers(d.name, p) }))
  })
  const removed = prod.flatMap(p => {
    const has = new Set(p.after.declarations.map(key))
    return p.before.declarations.filter(isConcept).filter(d => !has.has(key(d)))
  })
  return {
    added,
    removed,
    newModules: prod.filter(p => p.isNew).length,
    goneModules: prod.filter(p => p.isGone).length,
  }
}

export function abstractions(code: Pair[], measurable: boolean): Component {
  const { added, removed, newModules, goneModules } = newConcepts(code)
  const singleUse = added.filter(d => d.kind !== 'type' && d.consumers <= 1)
  const patterned = added.filter(d => PATTERN.test(d.name))
  const grown = added.reduce((n, d) => n + WEIGHT_OF[d.kind], 0) + newModules
  const shrunk = removed.reduce((n, d) => n + WEIGHT_OF[d.kind], 0) + goneModules
  const perBehaviour = grown / behaviourOf(code)
  const normalized = grown < shrunk
    ? signed(grown - shrunk, 4)
    : 0.6 * saturate(singleUse.length + patterned.length, 3) + 0.4 * saturate(perBehaviour - 0.25, 0.75)
  const names = (ds: { name: string }[]) => ds.slice(0, 4).map(d => d.name).join(', ') + (ds.length > 4 ? ', …' : '')
  const parts: string[] = []
  if (added.length) parts.push(`${plural(added.length, 'new abstraction')} (${names(added)})`)
  if (newModules) parts.push(plural(newModules, 'new module'))
  if (singleUse.length) parts.push(`${singleUse.length} with a single consumer (${names(singleUse)})`)
  if (patterned.length) parts.push(`${patterned.length} pattern-named`)
  if (removed.length) parts.push(`${plural(removed.length, 'abstraction')} removed`)
  if (goneModules) parts.push(`${plural(goneModules, 'module')} deleted`)
  return component('abstractions', 'abstraction growth', measurable ? normalized : null,
    { added: added.length, singleUse: singleUse.length, patternNamed: patterned.length, newModules, removed: removed.length + goneModules, perBehaviour: round(perBehaviour) },
    parts.join(', ') || 'no new abstractions')
}

export function amplification(code: Pair[], measurable: boolean): Component {
  const prod = prodOf(code)
  const { added, removed, newModules, goneModules } = newConcepts(code)
  const imports = Math.max(0, sum(prod, f => f.imports))
  const machinery = newModules + added.length + imports / 4
  const lessMachinery = goneModules + removed.length
  const behaviour = behaviourOf(code)
  const ratio = machinery / behaviour
  const normalized = machinery - lessMachinery < 0
    ? signed(machinery - lessMachinery, 4)
    : machinery < 2 ? 0 : saturate(ratio - 0.5, 1.5)
  return component('amplification', 'change amplification', measurable ? normalized : null,
    { machinery: round(machinery), behaviour: round(behaviour), ratio: round(ratio), imports },
    machinery < 2
      ? lessMachinery > 0 ? `removed ${plural(removed.length, 'abstraction')} and ${plural(goneModules, 'module')}` : 'no new machinery'
      : `${round(machinery)} units of machinery (modules, types, wiring) for ~${Math.round(behaviour)} of behaviour`)
}

export function typeWeakening(code: Pair[], measurable: boolean): Component {
  const prod = prodOf(code)
  const any = sum(prod, f => f.any)
  const casts = sum(prod, f => f.casts)
  const double = sum(prod, f => f.doubleCasts)
  const suppress = sum(prod, f => f.suppressions)
  const nonNull = sum(prod, f => f.nonNull)
  const weakened = any + 0.5 * casts + 2 * double + 2 * suppress + 0.3 * nonNull
  const parts = ([[any, '`any`'], [casts, '`as` cast'], [double, 'double cast'], [suppress, 'compiler suppression'], [nonNull, 'non-null assertion']] as const)
    .filter(([n]) => n !== 0)
    .map(([n, what]) => `${n > 0 ? '+' : ''}${n} ${what}${Math.abs(n) === 1 ? '' : 's'}`)
  return component('typeWeakening', 'type weakening', measurable ? signed(weakened, 3) : null,
    { any, casts, doubleCasts: double, suppressions: suppress, nonNull }, parts.join(', ') || 'no change in type safety')
}

const RUNTIME = ['dependencies', 'peerDependencies', 'optionalDependencies']

export function dependencies(files: FileVersion[]): Component {
  const manifests = files.filter(f => /(^|\/)package\.json$/.test(f.path))
  let runtime: string[] = []
  let dev: string[] = []
  let dropped = 0
  try {
    for (const f of manifests) {
      const before = JSON.parse(f.before ?? '{}')
      const after = JSON.parse(f.after ?? '{}')
      const names = (pkg: Record<string, Record<string, string>>, fields: string[]) =>
        new Set(fields.flatMap(field => Object.keys(pkg[field] ?? {})))
      const was = names(before, RUNTIME)
      const wasDev = names(before, ['devDependencies'])
      const now = names(after, RUNTIME)
      runtime.push(...[...now].filter(d => !was.has(d)))
      dev.push(...[...names(after, ['devDependencies'])].filter(d => !wasDev.has(d) && !was.has(d)))
      dropped += [...was].filter(d => !now.has(d)).length
    }
  } catch {
    return component('dependencies', 'dependency growth', null, {}, 'package.json could not be parsed')
  }
  const grown = runtime.length + 0.5 * dev.length - 0.5 * dropped
  const parts: string[] = []
  if (runtime.length) parts.push(`added runtime ${runtime.length === 1 ? 'dependency' : 'dependencies'} ${runtime.join(', ')}`)
  if (dev.length) parts.push(`added dev ${dev.length === 1 ? 'dependency' : 'dependencies'} ${dev.join(', ')}`)
  if (dropped) parts.push(`removed ${dropped} ${dropped === 1 ? 'dependency' : 'dependencies'}`)
  return component('dependencies', 'dependency growth', signed(grown, 1.5),
    { runtime: runtime.length, dev: dev.length, removed: dropped }, parts.join('; ') || 'no dependency changes')
}

/** Repeated 4-line code shapes across the changed production files. */
function duplicateWindows(shapes: string[][]): number {
  const seen = new Map<string, number>()
  for (const lines of shapes) {
    for (let i = 0; i + 4 <= lines.length; i++) {
      const window = lines.slice(i, i + 4)
      // Four identical lines are a table or a list, not a copied block.
      if (window.every(l => l === window[0])) continue
      const key = window.join('\n')
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  return [...seen.values()].reduce((n, count) => n + count - 1, 0)
}

export function duplication(code: Pair[], measurable: boolean): Component {
  const prod = prodOf(code)
  const before = duplicateWindows(prod.map(p => p.before.shapes))
  const after = duplicateWindows(prod.map(p => p.after.shapes))
  const delta = after - before
  return component('duplication', 'duplication delta', measurable ? signed(delta, 6) : null,
    { before, after, delta },
    delta > 0 ? `${delta} repeated code blocks introduced` : delta < 0 ? `${-delta} repeated code blocks removed` : 'no new repetition')
}

export function comments(code: Pair[], measurable: boolean): Component {
  const prod = prodOf(code)
  const restating = Math.max(0, sum(prod, f => f.restating))
  // Per file and growth only: code deleted elsewhere must not make new comments look excessive.
  const grown = (get: (f: Facts) => number) => prod.reduce((n, p) => n + Math.max(0, get(p.after) - get(p.before)), 0)
  const commentLines = grown(f => f.commentLines)
  const codeLines = grown(f => f.codeLines)
  const excess = Math.max(0, commentLines - 0.5 * codeLines - 3)
  const parts: string[] = []
  if (restating) parts.push(`${plural(restating, 'comment')} restating the code beneath`)
  if (excess > 0) parts.push(`${commentLines} comment lines for ${codeLines} code lines`)
  return component('comments', 'comment noise', measurable ? saturate(restating + excess / 6, 3) : null,
    { restating, commentLines, codeLines, docBlocks: sum(prod, f => f.docBlocks) }, parts.join(', ') || 'comments in proportion')
}

/**
 * Tests reduce the risk of new logic by a bounded amount (never enough to erase
 * structural slop); skipping or deleting tests adds risk.
 */
export function tests(code: Pair[], measurable: boolean): Component {
  const testFiles = code.filter(p => p.isTest)
  const cases = sum(testFiles, f => f.testCases)
  const assertions = sum(testFiles, f => f.assertions)
  const skipped = Math.max(0, sum(testFiles, f => f.skippedTests))
  const prod = prodOf(code)
  const newLogic = sum(prod, f => f.branches) > 0 || sum(prod, f => f.codeLines) > 0
  let points = 0
  const parts: string[] = []
  if (cases > 0 && assertions > 0 && newLogic) {
    points -= Math.min(8, 2 + 1.5 * cases)
    parts.push(`${plural(cases, 'test')} with ${plural(assertions, 'assertion')} cover the new logic`)
  }
  if (skipped > 0) {
    points += Math.min(6, 3 * skipped)
    parts.push(`${plural(skipped, 'test')} skipped`)
  }
  if (cases < 0) {
    points += Math.min(6, -2 * cases)
    parts.push(`${plural(-cases, 'test')} removed`)
  }
  points = Math.max(-8, Math.min(6, points))
  return {
    key: 'tests',
    label: 'test/risk modifier',
    weight: 0,
    normalized: measurable ? round(points / 8) : null,
    contribution: measurable ? round(points) : 0,
    raw: { cases, assertions, skipped },
    reason: parts.join(', ') || (newLogic ? 'new logic without new tests' : 'no test changes'),
  }
}

export function explain(s: Scored): string {
  const lines = [`SLOP SCORE ${s.score}  ${s.state}`, '']
  for (const c of [...s.components].sort((a, b) => b.contribution - a.contribution)) {
    const points = c.normalized === null ? '   –' : `${c.contribution >= 0 ? '+' : ''}${Math.round(c.contribution)}`.padStart(4)
    lines.push(`${points}  ${c.label}: ${c.normalized === null ? 'unavailable' : c.reason}`)
  }
  return lines.join('\n')
}

/** Lines added and removed between two texts, as git would count them. */
export function lineDiff(before: string, after: string): { added: number; deleted: number } {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  const common = x.length * y.length <= 250_000 ? lcs(x, y) : 0
  return { added: y.length - common, deleted: x.length - common }
}

const splitLines = (s: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))

function lcs(x: string[], y: string[]): number {
  let prev = new Array<number>(y.length + 1).fill(0)
  for (const xi of x) {
    const row = [0]
    for (let j = 0; j < y.length; j++) {
      row.push(xi === y[j] ? prev[j]! + 1 : Math.max(prev[j + 1]!, row[j]!))
    }
    prev = row
  }
  return prev[y.length]!
}
