export type SlopFileChange = {
  path: string
  added: number
  deleted: number
  /** The file did not exist before the turn. */
  isNew?: boolean
}

/** What the agent's edit tools did during a turn, per repo-relative path. */
export type SlopEditActivity = Record<string, { ops: number; added: number; deleted: number }>

export type SlopState = 'CLEAN' | 'MILD SLOP' | 'GETTING SLOPPY' | 'HEAVY SLOP' | 'BIG BALL OF MUD'

export type SlopComponent = {
  key: string
  label: string
  weight: number
  /** null when the metric could not be computed: excluded, not zeroed. */
  normalized: number | null
  /** Points this component adds to the 0–100 score. */
  contribution: number
  raw: Record<string, number>
  reason: string
  /** The names or paths the reason is about (single-consumer abstractions, churned files). */
  subjects?: string[]
}

export type SlopRecord = {
  at: number
  score: number
  state: SlopState
  /** Score change since the previous scored turn; null for the first. */
  delta: number | null
  components: SlopComponent[]
  changes: SlopFileChange[]
  /** The guard's mid-turn nudges to Claude during this turn, by signal. */
  nudges?: string[]
}

/** The turn in progress: kept in state so a hot reload mid-turn loses nothing. */
export type SlopTurn = {
  baseline: string | null
  edits: SlopEditActivity
  /** What the person asked for, so feedback can tell requested work from unrequested. */
  request?: string
  /** New classes, interfaces, enums and types the turn has introduced so far. */
  concepts?: string[]
  /** New Markdown files the turn has written so far. */
  docs?: string[]
  /** What the guard has already nudged Claude about this turn (a signal, or a signal and a file). */
  nudged?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'slop-o-meter': {
      turn: SlopTurn | null
      last: SlopRecord | null
      history: SlopRecord[]
      /** When this session began, so /slop report covers the session alone. */
      since: number | null
    }
  }
}
