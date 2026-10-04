// Turn baselines without touching the person's index, stash or refs: the
// whole working tree (untracked files included, .gitignore respected) is
// written as a tree object through a private index, once at the turn's start
// and once at its end, and the turn's change is the diff between the two.

import type { SlopFileChange as FileChange } from '../types/index.d.ts'

export type Run = (
  argv: string[],
  init?: { env?: Record<string, string> },
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
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .map(line => {
      const [added, deleted, path] = line.split('\t')
      // Binary files report '-': count them as one changed line each way.
      return { path: path!, added: added === '-' ? 1 : Number(added), deleted: deleted === '-' ? 1 : Number(deleted) }
    })
}
