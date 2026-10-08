// Delight, from the same measurements as the score: Płanetnik's verdict on a
// turn, the Sunbreak when a change climbs out of the red, the forecast of recent
// turns, and milestones earned by behaviour. Deterministic: the same history
// always gives the same words.

import type { SlopComponent, SlopRecord } from '../types/index.d.ts'
import { stateOf } from './score.ts'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const raw = (c: SlopComponent, key: string) => c.raw[key] ?? 0
/** The same record always picks the same variant. */
const pick = <T,>(record: SlopRecord, options: T[]) => options[Math.abs(Math.floor(record.at / 1000)) % options.length]!

/** A turn that climbed out of the red: from Heavy Slop or worse, down 30 or more, to Mild Slop or better. */
export function isSunbreak(record: SlopRecord): boolean {
  if (record.delta === null) return false
  return record.score - record.delta >= 61 && record.delta <= -30 && record.score <= 40
}

/** How many turns in a row, ending with the latest, were clean. */
export function cleanStreak(history: SlopRecord[]): number {
  let n = 0
  for (let i = history.length - 1; i >= 0 && history[i]!.state === 'CLEAN'; i--) n++
  return n
}

/** What Płanetnik says about each driver, from its measurements. */
const SAYINGS: Record<string, (c: SlopComponent) => string> = {
  surface: c => `${plural(raw(c, 'files'), 'file')} for one change. The wind is picking up.`,
  complexity: c => raw(c, 'longFunctions') > 0
    ? `${plural(raw(c, 'longFunctions'), 'function')} longer than a winter. Split them.`
    : 'Branches tangled like a thundercloud. Flatten them.',
  abstractions: c => `${plural(raw(c, 'added'), 'new abstraction')}${raw(c, 'singleUse') ? `, ${raw(c, 'singleUse')} with one consumer` : ''}. The clouds gather.`,
  amplification: () => 'All this machinery for so little behaviour. The pressure drops.',
  churn: c => `${Math.round((1 - raw(c, 'survival')) * 100)}% of your edits blew away. Choose a course and hold it.`,
  typeWeakening: c => raw(c, 'any') > 0 ? '`any`? I see through that fog.' : 'Casts and suppressions. The fog thickens.',
  dependencies: () => 'New dependencies for a small job. Travel lighter.',
  duplication: () => 'The same code, twice over. Echoes before a storm.',
  comments: () => 'Comments that repeat the code. Thunder without rain.',
  docs: c => `${plural(raw(c, 'newDocs'), 'document')} nobody asked for. Put it in your reply.`,
}

const CALM = ['Clear skies.', 'Calm weather. Carry on.', 'Not a cloud in sight.']

/** Płanetnik's verdict on the latest turn: one line, from its biggest driver, a storm cry at the extreme. */
export function verdict(record: SlopRecord, history: SlopRecord[]): string {
  if (isSunbreak(record)) return `The sun breaks through. ${record.score - record.delta!} down to ${record.score}. Well simplified.`
  const driver = [...record.components]
    .filter(c => c.weight > 0 && c.contribution >= 4 && SAYINGS[c.key])
    .sort((a, b) => b.contribution - a.contribution)[0]
  if (!driver || record.state === 'CLEAN') {
    const streak = cleanStreak(history)
    return streak >= 3 ? `Clear skies, ${streak} turns running.` : pick(record, CALM)
  }
  const said = SAYINGS[driver.key]!(driver)
  return record.state === 'BIG BALL OF MUD' ? `Burza! ${said}` : said
}

/** Glyphs every terminal font has; Heavy Slop and Big Ball of Mud share the bolt and differ by colour. */
const WEATHER = ['☀', '☁', '☂', 'ϟ', 'ϟ']

/** The weather for a score: sun, cloud, rain, then lightning. */
export const weather = (score: number) =>
  WEATHER[['CLEAN', 'MILD SLOP', 'GETTING SLOPPY', 'HEAVY SLOP', 'BIG BALL OF MUD'].indexOf(stateOf(score))]!

export type Milestone = { id: string; label: string }

export const MILESTONES: Milestone[] = [
  { id: 'storm', label: 'First storm survived' },
  { id: 'clear', label: 'Clear skies: 10 clean turns' },
  { id: 'sunbreak', label: 'Sunbreak' },
  { id: 'no-any', label: 'No `any` for 20 turns' },
  { id: 'net-negative', label: 'Net negative' },
]

const component = (r: SlopRecord, key: string) => r.components.find(c => c.key === key)
const added = (r: SlopRecord) => r.changes.reduce((n, c) => n + c.added, 0)
const deleted = (r: SlopRecord) => r.changes.reduce((n, c) => n + c.deleted, 0)

/** Milestones the history shows, earned by behaviour rather than one lucky number. */
export function milestonesIn(history: SlopRecord[]): string[] {
  const earned: string[] = []
  const stormAt = history.findIndex(r => r.score >= 61)
  if (stormAt >= 0 && history.slice(stormAt + 1).some(r => r.score <= 40)) earned.push('storm')
  let run = 0
  if (history.some(r => (run = r.state === 'CLEAN' ? run + 1 : 0) >= 10)) earned.push('clear')
  if (history.some(isSunbreak)) earned.push('sunbreak')
  run = 0
  if (history.some(r => (run = (component(r, 'typeWeakening')?.raw.any ?? 0) <= 0 ? run + 1 : 0) >= 20)) earned.push('no-any')
  if (history.some(r => r.state === 'CLEAN' && deleted(r) > added(r) && deleted(r) >= 10)) earned.push('net-negative')
  return earned
}
