// --ref (plan.md §5.10): analyze the code version that actually crashed.
// A detached git worktree of <ref> lives in the OS tmpdir for the duration of
// the run; it is removed on completion and on SIGINT, and stale worktrees
// from crashed runs (>24h) are GC'd on startup.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PREFIX = "crashpath-ref-";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface RefWorktree {
  root: string;
  cleanup: () => void;
}

/** Create the worktree and hand back an explicit cleanup (server mode keeps
 * it alive until exit). Throws with a clear message on bad ref / non-repo. */
export function addRefWorktree(repoRoot: string, ref: string): RefWorktree {
  gcStaleWorktrees(repoRoot);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
  const root = path.join(dir, "wt");
  try {
    execFileSync("git", ["-C", repoRoot, "worktree", "add", "--detach", root, ref], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    const stderr = ((err as { stderr?: Buffer }).stderr ?? "").toString().trim();
    throw new Error(
      `--ref ${ref}: ${stderr || "git worktree add failed — is this a git repository?"}`,
    );
  }
  let done = false;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    try {
      execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", root], {
        stdio: "ignore",
      });
    } catch {
      // worktree already gone; directory removal below still applies
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { root, cleanup };
}

/** One-shot form: worktree lives exactly as long as fn runs. */
export async function withRef<T>(
  repoRoot: string,
  ref: string,
  fn: (worktreeRoot: string) => Promise<T>,
): Promise<T> {
  const { root, cleanup } = addRefWorktree(repoRoot, ref);
  const onSigint = (): void => {
    cleanup();
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    return await fn(root);
  } finally {
    process.removeListener("SIGINT", onSigint);
    cleanup();
  }
}

function gcStaleWorktrees(repoRoot: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs < MAX_AGE_MS) continue;
      try {
        execFileSync(
          "git",
          ["-C", repoRoot, "worktree", "remove", "--force", path.join(dir, "wt")],
          {
            stdio: "ignore",
          },
        );
      } catch {
        // different repo or already pruned — directory removal is what matters
      }
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // racing another process: skip
    }
  }
}
