export type SlopFileChange = { path: string; added: number; deleted: number }

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
}

export type SlopRecord = {
  at: number
  score: number
  state: SlopState
  /** Score change since the previous scored turn; null for the first. */
  delta: number | null
  components: SlopComponent[]
  changes: SlopFileChange[]
}

/** The turn in progress: kept in state so a hot reload mid-turn loses nothing. */
export type SlopTurn = { baseline: string | null; edits: SlopEditActivity }

declare module 'claude-code' {
  interface PluginState {
    'slop-o-meter': {
      turn: SlopTurn | null
      last: SlopRecord | null
      history: SlopRecord[]
    }
  }
}
