// The Slop Score: raw metrics in, a 0–100 score and its reasons out.
// Pure: no Claude Code, no git, so it can be tested on its own.

import type {
  SlopComponent as Component,
  SlopEditActivity as EditActivity,
  SlopFileChange as FileChange,
  SlopState as State,
} from '../types/index.d.ts'

export type TurnInput = {
  /** The turn's net change: baseline tree versus final tree. */
  changes: FileChange[]
  edits: EditActivity
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

export function surface(changes: FileChange[]): Component {
  const prod = changes.filter(c => isProduction(c.path))
  const files = prod.length
  const dirs = new Set(prod.map(c => dirOf(c.path))).size
  const lines = prod.reduce((n, c) => n + c.added + c.deleted, 0)
  const normalized =
    0.45 * saturate(files - 1, 5) + 0.35 * saturate(dirs - 1, 3) + 0.2 * saturate(lines, 400)
  return component('surface', 'change surface', normalized, { files, dirs, lines },
    files === 0
      ? 'no production code changed'
      : `${plural(files, 'production file')} across ${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${lines} lines`)
}

export function churn(changes: FileChange[], edits: EditActivity): Component {
  const paths = Object.keys(edits)
  const volume = paths.reduce((n, p) => n + edits[p]!.added + edits[p]!.deleted, 0)
  const final = changes.reduce((n, c) => n + c.added + c.deleted, 0)
  const ops = paths.reduce((n, p) => n + edits[p]!.ops, 0)
  if (volume === 0) {
    return component('churn', 'agent churn', null, { volume, final, ops },
      'no edit-tool activity observed')
  }
  const survival = Math.min(1, final / volume)
  const wasted = Math.max(0, volume - final)
  const changed = new Set(changes.map(c => c.path))
  const abandoned = paths.filter(p => !changed.has(p)).length
  const normalized = saturate(wasted, 200) * Math.sqrt(1 - survival)
  const parts = [`${Math.round((1 - survival) * 100)}% of ${volume} edited lines did not survive`]
  if (abandoned) parts.push(`${plural(abandoned, 'file')} edited then reverted or deleted`)
  return component('churn', 'agent churn', normalized,
    { volume, final, ops, survival: round(survival), abandoned }, parts.join('; '))
}

function component(
  key: keyof typeof WEIGHTS,
  label: string,
  normalized: number | null,
  raw: Record<string, number>,
  reason: string,
): Component {
  const weight = WEIGHTS[key]
  const n = normalized === null ? null : round(Math.min(1, Math.max(0, normalized)))
  return { key, label, weight, normalized: n, contribution: 0, raw, reason }
}

const round = (x: number) => Math.round(x * 1000) / 1000

/**
 * Weighted sum over the metrics that could be computed, rescaled so the
 * unavailable ones neither count as zero nor as slop.
 */
export function combine(components: Component[]): Scored {
  const available = components.filter(c => c.normalized !== null)
  const total = available.reduce((n, c) => n + c.weight, 0)
  const scaled = components.map(c => ({
    ...c,
    contribution:
      c.normalized === null || total === 0 ? 0 : round((c.weight * c.normalized * 100) / total),
  }))
  const score = Math.round(Math.min(100, Math.max(0, scaled.reduce((n, c) => n + c.contribution, 0))))
  return { score, state: stateOf(score), components: scaled }
}

export function scoreTurn({ changes, edits }: TurnInput): Scored {
  return combine([surface(changes), churn(changes, edits)])
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
