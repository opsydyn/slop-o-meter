// Turn baselines without touching the person's index, stash or refs: the
// whole working tree (untracked files included, .gitignore respected) is
// written as a tree object through a private index, once at the turn's start
// and once at its end, and the turn's change is the diff between the two.

import type { SlopFileChange as FileChange } from '../types/index.d.ts'

export type Run = (
  argv: string[],
  init?: { env?: Record<string, string>; stdin?: string },
) => Promise<{ exitCode: number; stdout: string }>

export type Repo = { root: string; gitDir: string }

export async function findRepo(run: Run): Promise<Repo | null> {
  const r = await run(['git', 'rev-parse', '--show-toplevel', '--absolute-git-dir'])
  if (r.exitCode !== 0) return null
  const [root, gitDir] = r.stdout.trim().split('\n')
  return root && gitDir ? { root, gitDir } : null
}

/** Writes the working tree as a tree object and returns its id. */
export async function snapshot(run: Run, repo: Repo): Promise<string | null> {
  const index = `${repo.gitDir}/slop-o-meter.index`
  // Seed the private index from the real one the first time, so git can reuse
  // its stat cache instead of hashing every file.
  await run(['sh', '-c', 'test -f "$1" || cp "$2" "$1" 2>/dev/null || true', 'sh', index, `${repo.gitDir}/index`])
  const env = { GIT_INDEX_FILE: index }
  const add = await run(['git', '-C', repo.root, 'add', '-A', '--', '.'], { env })
  if (add.exitCode !== 0) return null
  const tree = await run(['git', '-C', repo.root, 'write-tree'], { env })
  return tree.exitCode === 0 ? tree.stdout.trim() : null
}

export async function diffTrees(run: Run, repo: Repo, before: string, after: string): Promise<FileChange[]> {
  if (before === after) return []
  const r = await run(['git', '-C', repo.root, 'diff', '--numstat', '--no-renames', '-z', before, after])
  if (r.exitCode !== 0) return []
  const created = await run(['git', '-C', repo.root, 'diff', '--name-only', '--diff-filter=A', '--no-renames', '-z', before, after])
  const isNew = new Set(created.exitCode === 0 ? created.stdout.split('\0').filter(Boolean) : [])
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .map(line => {
      const [added, deleted, path] = line.split('\t')
      // Binary files report '-': count them as one changed line each way.
      const change = { path: path!, added: added === '-' ? 1 : Number(added), deleted: deleted === '-' ? 1 : Number(deleted) }
      return isNew.has(change.path) ? { ...change, isNew: true } : change
    })
}

/**
 * Reads files as they stand in a tree, in one `git cat-file --batch`; a path
 * missing from the tree reads as null.
 */
export async function readFiles(run: Run, repo: Repo, tree: string, paths: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (paths.length === 0) return out
  const r = await run(['git', '-C', repo.root, 'cat-file', '--batch'], {
    stdin: paths.map(p => `${tree}:${p}`).join('\n') + '\n',
  })
  if (r.exitCode !== 0) return out
  // Sizes are in bytes, so walk the output as bytes.
  const bytes = new TextEncoder().encode(r.stdout)
  const decoder = new TextDecoder()
  let at = 0
  for (const path of paths) {
    const eol = bytes.indexOf(10, at)
    if (eol < 0) break
    const header = decoder.decode(bytes.subarray(at, eol))
    at = eol + 1
    const size = /^\S+ blob (\d+)$/.exec(header)?.[1]
    if (size === undefined) {
      out.set(path, null)
      continue
    }
    out.set(path, decoder.decode(bytes.subarray(at, at + Number(size))))
    at += Number(size) + 1
  }
  return out
}
