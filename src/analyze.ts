// A small JavaScript/TypeScript lexer and the per-file facts the metrics
// compare before and after a turn. A real tokenizer (strings, templates,
// comments, regex literals, brace nesting), not a parser: enough to count
// structure reliably without a compiler in the mod runtime.

export const ANALYZABLE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/

type Kind = 'word' | 'num' | 'str' | 'punct' | 'comment' | 'regex'
export type Token = { kind: Kind; text: string; line: number }

const PUNCT = ['===', '!==', '...', '??=', '||=', '&&=', '**=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '::']
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof'])
const WORD_START = /[A-Za-z_$À-￿#@]/
const WORD = /[A-Za-z0-9_$À-￿]/

export function lex(src: string): Token[] {
  const out: Token[] = []
  let line = 1
  let previous: Token | undefined
  for (let i = 0; i < src.length;) {
    const c = src.charAt(i)
    if (/\s/.test(c)) {
      if (c === '\n') line++
      i++
      continue
    }
    const [kind, end] = scan(src, i, previous)
    const token = { kind, text: src.slice(i, end), line }
    out.push(token)
    if (kind !== 'comment') previous = token
    line += token.text.split('\n').length - 1
    i = end
  }
  return out
}

/** The kind of the token starting at `i`, and where it ends. */
function scan(src: string, i: number, previous: Token | undefined): [Kind, number] {
  const c = src.charAt(i)
  const c2 = src.charAt(i + 1)
  if (c === '/' && c2 === '/') return ['comment', indexOr(src, '\n', i)]
  if (c === '/' && c2 === '*') return ['comment', indexOr(src, '*/', i + 2, 2)]
  if (c === '"' || c === "'") return ['str', scanQuote(src, i)]
  if (c === '`') return ['str', scanTemplate(src, i)]
  if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(c2))) return ['num', scanWhile(src, i, /[0-9a-zA-Z_.]/)]
  if (WORD_START.test(c)) return ['word', scanWhile(src, i, WORD)]
  if (c === '/' && regexMayStart(previous)) return ['regex', scanRegex(src, i)]
  const op = PUNCT.find(p => src.startsWith(p, i))
  return ['punct', i + (op?.length ?? 1)]
}

const indexOr = (src: string, what: string, from: number, past = 0) => {
  const at = src.indexOf(what, from)
  return at < 0 ? src.length : at + past
}

const scanWhile = (src: string, i: number, re: RegExp) => {
  let j = i + 1
  while (j < src.length && re.test(src.charAt(j))) j++
  return j
}

/** A quote never spans lines: stopping at the newline contains the damage of an apostrophe in JSX text. */
function scanQuote(src: string, i: number): number {
  const quote = src.charAt(i)
  let j = i + 1
  while (j < src.length && src.charAt(j) !== quote && src.charAt(j) !== '\n') j += src.charAt(j) === '\\' ? 2 : 1
  return src.charAt(j) === quote ? j + 1 : j
}

function scanTemplate(src: string, i: number): number {
  let depth = 0
  for (let j = i + 1; j < src.length; j++) {
    const d = src.charAt(j)
    if (d === '\\') j++
    else if (depth === 0 && d === '`') return j + 1
    else if (d === '$' && src.charAt(j + 1) === '{') { depth++; j++ }
    else if (depth > 0 && d === '{') depth++
    else if (depth > 0 && d === '}') depth--
  }
  return src.length
}

function scanRegex(src: string, i: number): number {
  let inClass = false
  let j = i + 1
  for (; j < src.length && src.charAt(j) !== '\n'; j++) {
    const d = src.charAt(j)
    if (d === '\\') j++
    else if (d === '[') inClass = true
    else if (d === ']') inClass = false
    else if (d === '/' && !inClass) break
  }
  return scanWhile(src, j, /[a-z]/)
}

function regexMayStart(previous: Token | undefined): boolean {
  if (!previous) return true
  if (previous.kind === 'punct') return !/^[)\]}]$/.test(previous.text)
  return previous.kind === 'word' && REGEX_AFTER_WORD.has(previous.text)
}

export type Declaration = {
  name: string
  kind: 'class' | 'interface' | 'type' | 'enum' | 'function'
  exported: boolean
}

export type Facts = {
  codeLines: number
  commentLines: number
  /** Decision points: if, loops, case, catch, ternaries, && || ??. */
  branches: number
  /** Cognitive complexity: control flow weighted by its nesting. */
  cognitive: number
  maxNesting: number
  functionLengths: number[]
  declarations: Declaration[]
  /** How often each identifier appears in code. */
  uses: Map<string, number>
  imports: number
  any: number
  casts: number
  doubleCasts: number
  nonNull: number
  suppressions: number
  /** Line comments that restate the code line beneath them. */
  restating: number
  docBlocks: number
  /** Normalized code lines (identifiers and literals erased), for duplication. */
  shapes: string[]
  testCases: number
  skippedTests: number
  assertions: number
}

const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else'])
const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var', 'new', 'this', 'super',
  'import', 'export', 'from', 'as', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof',
  'instanceof', 'in', 'of', 'extends', 'implements', 'public', 'private', 'protected', 'readonly',
  'static', 'abstract', 'yield', 'null', 'undefined', 'true', 'false', 'void', 'delete',
])
const TYPE_POSITION = new Set([':', '<', '|', '&', 'as', ','])
/** What an operator says in words, for comments that narrate it. */
const SPOKEN: Record<string, string[]> = { '++': ['increment', 'increase'], '--': ['decrement', 'decrease'], '=': ['set', 'assign'], '+=': ['add', 'increase'], '-=': ['subtract', 'decrease'] }
const STOP = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'from', 'into', 'then', 'set', 'get', 'new', 'add'])

/** Words of a comment or a name, crudely stemmed so "Builds queries" meets `QueryBuilder`. */
const words = (text: string) =>
  text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w))
    .map(w => w.replace(/ies$/, 'y').replace(/(ing|ers|er|es|ed|s)$/, ''))

const textAt = (code: Token[], k: number) => code[k]?.text ?? ''

export function analyze(src: string): Facts {
  const all = lex(src)
  const code = all.filter(t => t.kind !== 'comment')
  const f: Facts = {
    codeLines: new Set(code.map(t => t.line)).size,
    commentLines: 0, branches: 0, cognitive: 0, maxNesting: 0, functionLengths: [], declarations: [],
    uses: new Map(), imports: 0, any: 0, casts: 0, doubleCasts: 0, nonNull: 0, suppressions: 0,
    restating: 0, docBlocks: 0, shapes: shapesOf(code), testCases: 0, skippedTests: 0, assertions: 0,
  }
  walk(f, code)
  readComments(f, all.filter(t => t.kind === 'comment'), code)
  return f
}

type Walk = {
  /** Open braces: control blocks nest cognitive complexity; function bodies have lengths. */
  stack: { kind: 'control' | 'function' | 'plain'; line: number }[]
  pendingControl: boolean
  inModuleClause: boolean
  lastCloseParen: number
}

function walk(f: Facts, code: Token[]) {
  const w: Walk = { stack: [], pendingControl: false, inModuleClause: false, lastCloseParen: -1 }
  for (let k = 0; k < code.length; k++) {
    const t = code[k]
    if (t?.kind === 'word') onWord(f, code, k, w)
    else if (t?.kind === 'punct') onPunct(f, code, k, w)
    else if (t?.kind === 'str' && textAt(code, k - 1) === 'from') w.inModuleClause = false
  }
}

const nestingOf = (w: Walk) => w.stack.filter(s => s.kind === 'control').length

function onWord(f: Facts, code: Token[], k: number, w: Walk) {
  const word = textAt(code, k)
  const prev = textAt(code, k - 1)
  const next = textAt(code, k + 1)
  if (prev === '.') {
    if (/^(skip|todo|only)$/.test(word) && /^(it|test|describe)$/.test(textAt(code, k - 2))) f.skippedTests++
    return
  }
  if (!KEYWORDS.has(word)) f.uses.set(word, (f.uses.get(word) ?? 0) + 1)
  if (CONTROL.has(word)) {
    w.pendingControl = true
    if (word === 'else') f.cognitive += 1
    else if (word !== 'do' && !(word === 'if' && prev === 'else')) f.cognitive += 1 + nestingOf(w)
    if (word !== 'else' && word !== 'do') f.branches++
  }
  if (word === 'case') f.branches++
  if (w.stack.length === 0) {
    // `as` renames inside import/export lists and `* as ns`; it casts everywhere else.
    if (word === 'import' || (word === 'export' && ['{', '*', 'type'].includes(next))) w.inModuleClause = true
    if (word === 'import' && next !== '(') f.imports++
    declare(f, code, k)
  }
  if (word === 'any' && ((TYPE_POSITION.has(prev) && next !== ':') || next === '[')) f.any++
  if (word === 'as' && !w.inModuleClause) {
    if (next !== 'const') f.casts++
    if ((next === 'unknown' || next === 'any') && textAt(code, k + 2) === 'as') f.doubleCasts++
  }
  if ((word === 'test' || word === 'it') && next === '(') f.testCases++
  if (/^x(it|test|describe)$/.test(word) && next === '(') f.skippedTests++
  if ((word === 'expect' || word === 'assert') && next === '(') f.assertions++
}

function onPunct(f: Facts, code: Token[], k: number, w: Walk) {
  const t = code[k]
  const prev = code[k - 1]
  const next = textAt(code, k + 1)
  switch (t?.text) {
    case '&&': case '||': case '??':
      f.branches++
      f.cognitive++
      return
    case '?':
      if (next && ![':', ')', ',', '='].includes(next)) {
        f.branches++
        f.cognitive += 1 + nestingOf(w)
      }
      return
    case '!':
      if ((prev?.kind === 'word' || prev?.text === ')' || prev?.text === ']') && prev.line === t.line &&
          ['.', ')', ';', ',', '[', ']'].includes(next)) f.nonNull++
      return
    case ';':
      w.inModuleClause = false
      w.pendingControl = false
      return
    case ')':
      w.lastCloseParen = k
      return
    case '{': {
      const returnType = w.lastCloseParen >= 0 && textAt(code, w.lastCloseParen + 1) === ':' && k - w.lastCloseParen < 12
      const isFunction = prev?.text === '=>' || (!w.pendingControl && (prev?.text === ')' || returnType))
      w.stack.push({ kind: w.pendingControl ? 'control' : isFunction ? 'function' : 'plain', line: t.line })
      w.pendingControl = false
      f.maxNesting = Math.max(f.maxNesting, nestingOf(w))
      return
    }
    case '}': {
      const open = w.stack.pop()
      if (w.stack.length === 0) w.inModuleClause = false
      if (open?.kind === 'function' && t) f.functionLengths.push(t.line - open.line + 1)
    }
  }
}

/** Suppressions, doc blocks, and comments that only restate the line beneath them. */
function readComments(f: Facts, comments: Token[], code: Token[]) {
  const lines = byLine(code)
  for (const c of comments) {
    const span = c.text.split('\n').length
    f.commentLines += span
    if (/@ts-(ignore|expect-error|nocheck)|eslint-disable/.test(c.text)) f.suppressions++
    if (c.text.startsWith('/**')) f.docBlocks++
    if (lines.has(c.line)) continue
    const said = words(c.text.replace(/^\/[/*]+|\*+\/$|^\s*\*/gm, ''))
    const codeWords = new Set((lines.get(c.line + span) ?? []).flatMap(t =>
      t.kind === 'word' ? words(t.text) : SPOKEN[t.text] ?? []))
    const echoed = said.filter(w => codeWords.has(w))
    if (said.length > 0 && said.length <= 8 && echoed.length / said.length >= 0.6) f.restating++
  }
}

/** Each substantial code line with names and literals erased, imports skipped. */
function shapesOf(code: Token[]): string[] {
  return [...byLine(code).values()]
    .filter(tokens => tokens.length >= 5 && tokens[0]?.text !== 'import' && !tokens.some(t => t.text === 'from'))
    .map(shapeOf)
}

function byLine(code: Token[]): Map<number, Token[]> {
  const lines = new Map<number, Token[]>()
  for (const t of code) lines.set(t.line, [...(lines.get(t.line) ?? []), t])
  return lines
}

const shapeOf = (tokens: Token[]) => tokens.map(t =>
  t.kind === 'word' && !KEYWORDS.has(t.text) ? 'i' : t.kind === 'num' ? '0' : t.kind === 'str' ? '"' : t.text,
).join(' ')

/**
 * The shape of an edit: the lines it removed and added, names and literals
 * erased. The same rename repeated across files has one shape.
 */
export function editShape(before: string, after: string): string {
  const lines = (src: string) => src.split('\n').map(l => l.trim()).filter(Boolean)
  const was = lines(before)
  const now = lines(after)
  const minus = (a: string[], b: string[]) => {
    const left = [...b]
    return a.filter(l => {
      const at = left.indexOf(l)
      if (at >= 0) left.splice(at, 1)
      return at < 0
    })
  }
  const shape = (ls: string[]) => ls.map(l => shapeOf(lex(l).filter(t => t.kind !== 'comment'))).sort().join('\n')
  return `${shape(minus(was, now))}\n→\n${shape(minus(now, was))}`
}

function declare(f: Facts, code: Token[], k: number) {
  const name = code[k + 1]
  if (name?.kind !== 'word') return
  const before = textAt(code, k - 1)
  const exported = before === 'export' ||
    ((before === 'default' || before === 'abstract') && textAt(code, k - 2) === 'export')
  const add = (kind: Declaration['kind']) => f.declarations.push({ name: name.text, kind, exported })
  const after = textAt(code, k + 2)
  switch (textAt(code, k)) {
    case 'class': return add('class')
    case 'enum': return add('enum')
    case 'function': return add('function')
    case 'interface': return ['{', 'extends', '<'].includes(after) ? add('interface') : undefined
    case 'type': return ['=', '<'].includes(after) ? add('type') : undefined
    case 'const': case 'let': case 'var': {
      if (after !== '=') return
      const rhs = code[k + 3]
      const isFn = rhs?.text === 'function' || rhs?.text === 'async' ||
        (rhs?.kind === 'word' && textAt(code, k + 4) === '=>') ||
        (rhs?.text === '(' && arrowFollows(code, k + 3))
      if (isFn) add('function')
    }
  }
}

function arrowFollows(code: Token[], open: number): boolean {
  let depth = 0
  for (let j = open; j < code.length && j < open + 200; j++) {
    if (textAt(code, j) === '(') depth++
    if (textAt(code, j) === ')' && --depth === 0) return ['=>', ':'].includes(textAt(code, j + 1))
  }
  return false
}
