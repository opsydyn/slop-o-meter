// Whole-turn scenarios: the repository's files before and after a turn.
// Each is a plausible piece of agent output for the same small request,
// "add a search endpoint", unless named otherwise.

export type Scenario = { before: Record<string, string>; after: Record<string, string> }

const ROUTES = `import { listItems } from './items'

export function route(path: string, query: URLSearchParams) {
  if (path === '/items') return listItems()
  return { status: 404 }
}
`

const ITEMS = `export type Item = { id: string; name: string }

const items: Item[] = []

export function listItems() {
  return items
}
`

const base = { 'src/routes.ts': ROUTES, 'src/items.ts': ITEMS }

export const direct: Scenario = {
  before: base,
  after: {
    ...base,
    'src/routes.ts': ROUTES.replace(
      "  return { status: 404 }",
      "  if (path === '/search') return searchItems(query.get('q') ?? '')\n  return { status: 404 }",
    ).replace("import { listItems }", "import { listItems, searchItems }"),
    'src/items.ts': ITEMS + `
export function searchItems(q: string) {
  return items.filter(item => item.name.toLowerCase().includes(q.toLowerCase()))
}
`,
  },
}

export const normal: Scenario = {
  before: base,
  after: {
    ...base,
    'src/routes.ts': direct.after['src/routes.ts']!.replace(
      "import { listItems, searchItems } from './items'",
      "import { listItems } from './items'\nimport { searchItems } from './search'",
    ),
    'src/search.ts': `import { listItems, type Item } from './items'

export function searchItems(q: string, limit = 20): Item[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return listItems()
    .filter(item => item.name.toLowerCase().includes(needle))
    .slice(0, limit)
}
`,
  },
}

export const overEngineered: Scenario = {
  before: base,
  after: {
    ...base,
    'src/routes.ts': ROUTES.replace(
      "  return { status: 404 }",
      "  if (path === '/search') return SearchControllerFactory.create().handle(query)\n  return { status: 404 }",
    ).replace("import { listItems } from './items'", "import { listItems } from './items'\nimport { SearchControllerFactory } from './search/SearchControllerFactory'"),
    'src/search/ISearchRepository.ts': `import type { Item } from '../items'

/**
 * Repository abstraction for searching items.
 */
export interface ISearchRepository {
  /** Finds items matching a query. */
  find(query: SearchQuery): Item[]
}

export type SearchQuery = { text: string; limit: number }
`,
    'src/search/InMemorySearchRepository.ts': `import { listItems, type Item } from '../items'
import type { ISearchRepository, SearchQuery } from './ISearchRepository'

/**
 * In-memory implementation of the search repository.
 */
export class InMemorySearchRepository implements ISearchRepository {
  // find items
  find(query: SearchQuery): Item[] {
    // filter the items
    return listItems().filter(item => item.name.toLowerCase().includes(query.text))
  }
}
`,
    'src/search/SearchConfig.ts': `/**
 * Configuration for the search service.
 */
export interface SearchConfig {
  /** The default limit. */
  defaultLimit: number
}

export const defaultSearchConfig: SearchConfig = { defaultLimit: 20 }
`,
    'src/search/SearchQueryBuilder.ts': `import type { SearchQuery } from './ISearchRepository'
import type { SearchConfig } from './SearchConfig'

/**
 * Builds search queries.
 */
export class SearchQueryBuilder {
  constructor(private readonly config: SearchConfig) {}

  // build the query
  build(text: string): SearchQuery {
    return { text: text.trim().toLowerCase(), limit: this.config.defaultLimit }
  }
}
`,
    'src/search/SearchService.ts': `import type { Item } from '../items'
import type { ISearchRepository } from './ISearchRepository'
import { SearchQueryBuilder } from './SearchQueryBuilder'

/**
 * Service orchestrating searches.
 */
export class SearchService {
  constructor(private readonly repository: ISearchRepository, private readonly builder: SearchQueryBuilder) {}

  /** Searches for items. */
  search(text: string): Item[] {
    const query = this.builder.build(text)
    return this.repository.find(query).slice(0, query.limit)
  }
}
`,
    'src/search/SearchAdapter.ts': `import type { SearchService } from './SearchService'

/**
 * Adapts HTTP queries to the search service.
 */
export class SearchAdapter {
  constructor(private readonly service: SearchService) {}

  // handle the query
  handle(query: URLSearchParams) {
    return this.service.search(query.get('q') as any as string)
  }
}
`,
    'src/search/SearchControllerFactory.ts': `import { InMemorySearchRepository } from './InMemorySearchRepository'
import { defaultSearchConfig } from './SearchConfig'
import { SearchQueryBuilder } from './SearchQueryBuilder'
import { SearchService } from './SearchService'
import { SearchAdapter } from './SearchAdapter'

/**
 * Factory creating search controllers.
 */
export class SearchControllerFactory {
  /** Creates a controller. */
  static create(): SearchAdapter {
    const repository = new InMemorySearchRepository()
    const builder = new SearchQueryBuilder(defaultSearchConfig)
    return new SearchAdapter(new SearchService(repository, builder))
  }
}
`,
  },
}

/** The over-engineered search collapsed back into the direct implementation. */
export const simplification: Scenario = { before: overEngineered.after, after: direct.after }

const LEGACY = `// TODO: clean this up someday
export function price(o: any, u: any, flags: any) {
  let t = 0
  for (let i = 0; i < o.items.length; i++) {
    if (o.items[i].type == 'a') {
      if (u && u.vip) {
        if (flags.promo) { t += o.items[i].p * 0.7 } else { t += o.items[i].p * 0.8 }
      } else {
        if (flags.promo) { t += o.items[i].p * 0.9 } else { t += o.items[i].p }
      }
    } else if (o.items[i].type == 'b') {
      t += o.items[i].p * (u && u.vip ? 0.85 : 1)
    } else {
      t += o.items[i].p
    }
  }
  if (o.coupon && o.coupon.length > 3 && !flags.noCoupons) t = t - 5
  return t < 0 ? 0 : t
}
`

/** A minimal, clean fix inside an ugly legacy function. */
export const legacyFix: Scenario = {
  before: { 'src/legacy/pricing.ts': LEGACY },
  after: { 'src/legacy/pricing.ts': LEGACY.replace('t = t - 5', 't = Math.max(0, t - 5)') },
}

/** A large but coherent change: one function renamed and reshaped across many call sites. */
export const largeRefactor: Scenario = (() => {
  const before: Record<string, string> = { 'src/log.ts': 'export function log(msg: string) {\n  console.log(msg)\n}\n' }
  const after: Record<string, string> = {
    'src/log.ts': "export function logEvent(event: string, detail: Record<string, string> = {}) {\n  console.log(JSON.stringify({ event, ...detail }))\n}\n",
  }
  for (const area of ['billing', 'orders', 'users', 'catalog', 'auth', 'search']) {
    for (const file of ['create', 'update', 'remove']) {
      const path = `src/${area}/${file}.ts`
      const body = (call: (what: string) => string) => `import { ${call('x').startsWith('logEvent') ? 'logEvent' : 'log'} } from '../log'

export function ${file}${area[0]!.toUpperCase()}${area.slice(1)}(id: string) {
  ${call(`${area} ${file}`)}
  return { id, ok: true }
}
`
      before[path] = body(what => `log('${what} ' + id)`)
      after[path] = body(what => `logEvent('${what.replace(' ', '.')}', { id })`)
    }
  }
  return { before, after }
})()

const RISKY = (extra: string) => `export function refund(amount: number, paid: number, isAdmin: boolean) {
  if (amount <= 0) throw new Error('nothing to refund')
  if (amount > paid && !isAdmin) throw new Error('refund exceeds payment')
  ${extra}
  return Math.min(amount, isAdmin ? amount : paid)
}
`
const RISKY_BEFORE = 'export function refund(amount: number) {\n  return amount\n}\n'

export const untestedRisk: Scenario = {
  before: { 'src/refund.ts': RISKY_BEFORE },
  after: { 'src/refund.ts': RISKY("if (paid === 0 && !isAdmin) return 0") },
}

export const testedRisk: Scenario = {
  before: { 'src/refund.ts': RISKY_BEFORE, 'tests/refund.test.ts': "import { refund } from '../src/refund'\n" },
  after: {
    'src/refund.ts': RISKY("if (paid === 0 && !isAdmin) return 0"),
    'tests/refund.test.ts': `import { refund } from '../src/refund'

test('rejects zero', () => { expect(() => refund(0, 10, false)).toThrow() })
test('caps at payment for customers', () => { expect(() => refund(20, 10, false)).toThrow() })
test('admins may exceed payment', () => { expect(refund(20, 10, true)).toBe(20) })
test('nothing paid, nothing back', () => { expect(refund(5, 0, false)).toBe(0) })
`,
  },
}

/** The direct implementation, but typed away. */
export const weakTyping: Scenario = {
  before: base,
  after: {
    ...direct.after,
    'src/items.ts': ITEMS + `
// @ts-ignore
export function searchItems(q: any) {
  return (items as any[]).filter((item: any) => item!.name.includes(q as unknown as string))
}
`,
  },
}

/** The direct implementation, but pulling in a library for it. */
export const needlessDependency: Scenario = {
  before: { ...base, 'package.json': '{ "name": "app", "dependencies": {} }' },
  after: {
    ...direct.after,
    'package.json': '{ "name": "app", "dependencies": { "lodash": "^4.17.21", "fuse.js": "^7.0.0" } }',
  },
}
