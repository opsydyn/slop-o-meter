import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { diffTrees, findRepo, readFiles, snapshot, type Run } from '../src/git.ts'

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
      { path: 'src/new.ts', added: 1, deleted: 0 },
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
