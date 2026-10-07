// Feedback to Claude, built from the same measurements as the score: mid-turn
// nudges, a strict-mode note after an over-budget turn, the Simplify prompt and
// the session report. Advisory text only: nothing here changes a score.

import { analyze, ANALYZABLE } from './analyze.ts'
import { isProduction, PATTERN } from './score.ts'
import type { SlopComponent, SlopRecord, SlopTurn } from '../types/index.d.ts'

const SIGNED = 'Slop-O-Meter (advisory, from measurements):'
/** How many pattern-named abstractions a turn may add before the guard says so. */
const CONCEPTS_BEFORE_NUDGE = 3
/** How many edits to one file before the guard asks the agent to settle on an approach. */
const EDITS_BEFORE_NUDGE = 5

export type Nudge = { signal: 'abstractions' | 'churn' | 'types'; text: string }

const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ', …' : '')

/**
 * What one edit tells the guard, given the turn so far: the nudges it earns
 * (each signal at most once a turn) and the turn's pattern-named concepts after it.
 */
export function nudgesFor(
  turn: SlopTurn,
  path: string,
  before: string,
  after: string,
): { nudges: Nudge[]; concepts: string[] } {
  const nudged = new Set(turn.nudged ?? [])
  let concepts = turn.concepts ?? []
  const nudges: Nudge[] = []
  const say = (signal: Nudge['signal'], text: string) => {
    if (!nudged.has(signal)) nudges.push({ signal, text: `${SIGNED} ${text}` })
  }
  if (isProduction(path) && ANALYZABLE.test(path)) {
    const was = analyze(before)
    const now = analyze(after)
    const had = new Set(was.declarations.map(d => d.name))
    const added = now.declarations
      .filter(d => d.kind !== 'function' && !had.has(d.name) && PATTERN.test(d.name))
      .map(d => d.name)
    concepts = [...new Set([...concepts, ...added])]
    if (added.length > 0 && concepts.length >= CONCEPTS_BEFORE_NUDGE) {
      say('abstractions', `this turn has introduced ${concepts.length} pattern-named abstractions (${list(concepts)}). ` +
        'Each layer should be required by the task; where one will do, prefer a direct implementation and existing code.')
    }
    const weakening = [
      [now.any - was.any, '`any`'],
      [now.doubleCasts - was.doubleCasts, 'a double cast'],
      [now.suppressions - was.suppressions, 'a compiler suppression'],
    ].filter(([n]) => (n as number) > 0).map(([, what]) => what)
    if (weakening.length > 0) {
      say('types', `this edit adds ${weakening.join(' and ')} to ${path}. Prefer a real type over weakening the checker.`)
    }
  }
  const edits = turn.edits[path]?.ops ?? 0
  if (edits >= EDITS_BEFORE_NUDGE) {
    say('churn', `${path} has been edited ${edits} times this turn. Settle on one approach before rewriting it again.`)
  }
  return { nudges, concepts }
}

const drivers = (record: SlopRecord) =>
  [...record.components].filter(c => c.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 3)

const line = (c: SlopComponent) => `${c.label}: ${c.reason}`

/** The note strict mode leaves for the next turn after an over-budget one; null when within budget. */
export function strictNote(record: SlopRecord, budget: number): string | null {
  if (record.score <= budget) return null
  return `Slop-O-Meter (strict mode): your previous change scored ${record.score} (${record.state}), over the budget of ${budget}. ` +
    `What drove it: ${drivers(record).map(line).join('; ')}. ` +
    'In your next change, prefer deletion, reuse, direct implementations and existing patterns, and do not introduce ' +
    'abstractions unless the task requires them. This note is advisory and does not affect the score.'
}

/** The prompt the pane's Simplify button sends: the last change, what drove its score, and what to do about it. */
export function simplifyPrompt(record: SlopRecord): string {
  const top = drivers(record)
  const subjects = [...new Set(top.flatMap(c => c.subjects ?? []))]
  return [
    `Simplify the change you just made without changing its behaviour. Slop-O-Meter scored it ${record.score} (${record.state}). What drove the score:`,
    ...top.map(c => `- ${line(c)}`),
    ...(subjects.length ? [`Look first at: ${list(subjects)}.`] : []),
    'Remove layers that have a single consumer, inline helpers used once, restore type safety where it was weakened, ' +
      'and keep the tests passing. Do not introduce new abstractions.',
  ].join('\n')
}

/** `/slop report`: the session's scored turns, worst and best moments, and what the guard said. */
export function report(records: SlopRecord[], budget: number): string {
  if (records.length === 0) return 'Slop-O-Meter: no scored turns this session yet.'
  const scores = records.map(r => r.score)
  const sorted = [...scores].sort((a, b) => a - b)
  const average = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const median = sorted[Math.floor(sorted.length / 2)]!
  const worst = records.reduce((a, b) => (b.score > a.score ? b : a))
  const best = records.reduce((a, b) => ((b.delta ?? 0) < (a.delta ?? 0) ? b : a))
  const time = (r: SlopRecord) => new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const recurring = new Map<string, number>()
  for (const r of records) for (const c of drivers(r)) recurring.set(c.label, (recurring.get(c.label) ?? 0) + 1)
  const nudges = records.flatMap(r => r.nudges ?? [])
  const lines = [
    'SLOP REPORT: this session',
    '',
    `turns scored ${records.length}   average ${average}   median ${median}   over budget (${budget}) ${scores.filter(s => s > budget).length}`,
    `worst  ${worst.score} ${worst.state} at ${time(worst)}: ${drivers(worst).map(c => c.label).join(', ') || 'no single driver'}`,
  ]
  if ((best.delta ?? 0) < 0) lines.push(`best simplification  ${best.delta} to ${best.score} at ${time(best)}`)
  lines.push(`trend  ${scores.slice(-12).join(' → ')}`)
  if (recurring.size) {
    lines.push(`recurring  ${[...recurring].sort((a, b) => b[1] - a[1]).map(([label, n]) => `${label} ×${n}`).join(', ')}`)
  }
  if (nudges.length) {
    const by = new Map<string, number>()
    for (const n of nudges) by.set(n, (by.get(n) ?? 0) + 1)
    lines.push(`guard nudges  ${nudges.length} (${[...by].map(([s, n]) => `${s} ${n}`).join(', ')})`)
  }
  return lines.join('\n')
}
