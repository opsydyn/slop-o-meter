import { beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { diffTrees, findRepo, readFiles, removeIndexes, snapshot, untrackedCount, type Run } from '../src/git.ts'

let dir: string
const run: Run = async (argv, init) => {
  const p = Bun.spawnSync(argv, { cwd: dir, env: { ...process.env, ...init?.env }, stdin: init?.stdin === undefined ? undefined : Buffer.from(init.stdin) })
  return { exitCode: p.exitCode, stdout: p.stdout.toString() }
}
const write = (path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}
const git = (...args: string[]) => run(['git', ...args])

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'slop-git-'))
  await git('init', '-q')
  await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
})

describe('turn baseline', () => {
  test('is null outside a git repository', async () => {
    rmSync(join(dir, '.git'), { recursive: true })
    expect(await findRepo(run)).toBeNull()
  })

  test('pre-existing uncommitted work is not attributed to the turn', async () => {
    write('user.ts', 'user work\n'.repeat(50))
    write('notes/untracked.txt', 'mine\n')
    const repo = (await findRepo(run))!
    const before = (await snapshot(run, repo))!

    write('user.ts', 'user work\n'.repeat(50) + 'agent line\n')
    write('src/new.ts', 'export const x = 1\n')
    const after = (await snapshot(run, repo))!

    const changes = await diffTrees(run, repo, before, after)
    expect(changes.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'src/new.ts', added: 1, deleted: 0, isNew: true },
      { path: 'user.ts', added: 1, deleted: 0 },
    ])
  })

  test('leaves the real index untouched', async () => {
    write('a.ts', 'a\n')
    const repo = (await findRepo(run))!
    await snapshot(run, repo)
    const status = await git('status', '--porcelain')
    expect(status.stdout).toContain('?? a.ts')
  })

  test('respects .gitignore', async () => {
    write('.gitignore', 'dist/\n')
    const repo = (await findRepo(run))!
    const before = (await snapshot(run, repo))!
    write('dist/bundle.js', 'x\n'.repeat(1000))
    const after = (await snapshot(run, repo))!
    expect(await diffTrees(run, repo, before, after)).toEqual([])
  })

  test('a file created and deleted within the turn leaves no change', async () => {
    const repo = (await findRepo(run))!
    const before = (await snapshot(run, repo))!
    write('tmp.ts', 'x\n')
    rmSync(join(dir, 'tmp.ts'))
    const after = (await snapshot(run, repo))!
    expect(await diffTrees(run, repo, before, after)).toEqual([])
  })
})

describe('readFiles', () => {
  test('reads each side of the turn, null where a file did not exist', async () => {
    write('a.ts', 'héllo ✓\nline 2\n')
    const repo = (await findRepo(run))!
    const before = (await snapshot(run, repo))!
    write('b.ts', 'new\n')
    const after = (await snapshot(run, repo))!
    const old = await readFiles(run, repo, before, ['a.ts', 'b.ts'])
    expect(old.get('a.ts')).toBe('héllo ✓\nline 2\n')
    expect(old.get('b.ts')).toBeNull()
    expect((await readFiles(run, repo, after, ['b.ts'])).get('b.ts')).toBe('new\n')
  })
})

describe('sessions sharing a repository', () => {
  test('a session holding its index lock does not block another session', async () => {
    write('a.ts', 'a\n')
    const repo = (await findRepo(run))!
    // One session mid-snapshot: git holds its index lock.
    writeFileSync(`${repo.gitDir}/slop-o-meter-one.index.lock`, '')
    expect(await snapshot(run, repo, 'one')).toBeNull()
    expect(await snapshot(run, repo, 'two')).toMatch(/^[0-9a-f]{40}$/)
  })

  test('stale indexes of other sessions are removed; the current one is kept', async () => {
    const repo = (await findRepo(run))!
    for (const key of ['mine', 'old', 'recent']) await snapshot(run, repo, key)
    const dayAgo = new Date(Date.now() - 2 * 86_400_000)
    utimesSync(`${repo.gitDir}/slop-o-meter-old.index`, dayAgo, dayAgo)
    utimesSync(`${repo.gitDir}/slop-o-meter-mine.index`, dayAgo, dayAgo)
    await removeIndexes(run, repo, { keep: 'mine', staleOnly: true })
    expect(existsSync(`${repo.gitDir}/slop-o-meter-old.index`)).toBe(false)
    expect(existsSync(`${repo.gitDir}/slop-o-meter-mine.index`)).toBe(true)
    expect(existsSync(`${repo.gitDir}/slop-o-meter-recent.index`)).toBe(true)
    await removeIndexes(run, repo)
    expect(existsSync(`${repo.gitDir}/slop-o-meter-mine.index`)).toBe(false)
  })
})

describe('untracked files', () => {
  test('counts what a snapshot would hash, not what is ignored', async () => {
    write('.gitignore', 'node_modules/\n')
    write('node_modules/x/index.js', 'x')
    write('dist/a.js', 'a')
    write('dist/b.js', 'b')
    const repo = (await findRepo(run))!
    expect(await untrackedCount(run, repo)).toBe(3)
  })
})
