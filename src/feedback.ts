// Feedback to Claude, built from the same measurements as the score: mid-turn
// nudges, a strict-mode note after an over-budget turn, the Simplify prompt and
// the session report. Advisory text only: nothing here changes a score.

import { analyze, ANALYZABLE } from './analyze.ts'
import { asksForDocs, isProduction, PATTERN } from './score.ts'
import type { SlopComponent, SlopRecord, SlopTurn } from '../types/index.d.ts'

const SIGNED = 'Slop-O-Meter (advisory, from measurements):'
/** Pattern-named abstractions (…Service, …Factory, …Validator) a turn may add before the guard says so. */
const PATTERNED_BEFORE_NUDGE = 3
/** New types and classes of any name a turn may add before the guard says so. */
const TYPES_BEFORE_NUDGE = 6
/** How many edits to one file before the guard asks the agent to settle on an approach. */
const EDITS_BEFORE_NUDGE = 5
/** New Markdown files a turn may write, unasked, before the guard says so. */
const DOCS_BEFORE_NUDGE = 2
/** Type weakening is flagged per file, up to this many files a turn. */
const TYPE_FILES_PER_TURN = 3

export type Nudge = {
  signal: 'abstractions' | 'churn' | 'types' | 'docs'
  /** What the guard remembers it said: a signal, or a signal and the file it was about. */
  key: string
  text: string
}

export type Guarded = { nudges: Nudge[]; concepts: string[]; docs: string[] }

const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ', …' : '')
const MARKDOWN = /\.(md|mdx|rst)$/i

/**
 * What one edit tells the guard, given the turn so far: the nudges it earns (each
 * key at most once a turn) and the turn's new concepts and documents after it.
 * `before` is null when the edit created the file.
 */
export function nudgesFor(turn: SlopTurn, path: string, before: string | null, after: string): Guarded {
  const nudged = new Set(turn.nudged ?? [])
  const nudges: Nudge[] = []
  const say = (signal: Nudge['signal'], key: string, text: string) => {
    if (!nudged.has(key)) nudges.push({ signal, key, text: `${SIGNED} ${text}` })
  }
  let concepts = turn.concepts ?? []
  let docs = turn.docs ?? []

  if (isProduction(path) && ANALYZABLE.test(path)) {
    const was = analyze(before ?? '')
    const now = analyze(after)
    const had = new Set(was.declarations.map(d => d.name))
    const added = now.declarations.filter(d => d.kind !== 'function' && !had.has(d.name)).map(d => d.name)
    concepts = [...new Set([...concepts, ...added])]
    const patterned = concepts.filter(name => PATTERN.test(name))
    if (added.length > 0 && patterned.length >= PATTERNED_BEFORE_NUDGE) {
      say('abstractions', 'abstractions', `this turn has introduced ${patterned.length} pattern-named abstractions (${list(patterned)}). ` +
        'Each layer should be required by the task; where one will do, prefer a direct implementation and existing code.')
    } else if (added.length > 0 && concepts.length >= TYPES_BEFORE_NUDGE) {
      say('abstractions', 'abstractions', `this turn has introduced ${concepts.length} new types and classes (${list(concepts)}). ` +
        'Prefer fewer, existing or inferred types; a separate input or result type for every function is rarely needed.')
    }
    const weakening = [
      [now.any - was.any, '`any`'],
      [now.doubleCasts - was.doubleCasts, 'a double cast'],
      [now.suppressions - was.suppressions, 'a compiler suppression'],
    ].filter(([n]) => (n as number) > 0).map(([, what]) => what)
    const typeFiles = [...nudged].filter(k => k.startsWith('types:')).length
    if (weakening.length > 0 && typeFiles < TYPE_FILES_PER_TURN) {
      say('types', `types:${path}`, `this edit adds ${weakening.join(' and ')} to ${path}. Prefer a real type over weakening the checker.`)
    }
  }

  if (before === null && MARKDOWN.test(path)) {
    docs = [...new Set([...docs, path])]
    if (docs.length >= DOCS_BEFORE_NUDGE && !asksForDocs(turn.request ?? '')) {
      say('docs', 'docs', `this turn has written ${docs.length} new Markdown files (${list(docs)}) that the request did not ask for. ` +
        'Unless documentation is part of the task, put the summary in your reply instead of new files.')
    }
  }

  const edits = turn.edits[path]?.ops ?? 0
  if (edits >= EDITS_BEFORE_NUDGE) {
    say('churn', 'churn', `${path} has been edited ${edits} times this turn. Settle on one approach before rewriting it again.`)
  }
  return { nudges, concepts, docs }
}

/**
 * The briefing Claude reads at the start of a session while the guard is on: what is measured, before
 * anything is designed, so the plan can avoid it rather than a nudge correcting it halfway through.
 */
export function briefing(budget: number): string {
  return [
    'Slop-O-Meter is measuring each change in this session, deterministically, from the diff and your edits. It counts:',
    'how widely a change spreads; new types, classes and layers relative to the behaviour added; type weakening',
    '(any, casts, @ts-ignore); new documentation files the request did not ask for; and code written then rewritten',
    `or thrown away. Budget: ${budget} per turn; lower is better. Prefer direct implementations, existing code and`,
    'types, and a summary in your reply over new files. Never cut requested scope, tests or correctness to lower the score.',
  ].join(' ')
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
