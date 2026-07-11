# Security posture

crashpath is a local-first developer tool:

- The HTTP server binds **127.0.0.1 only**, on a random free port by default.
- `/api/source` resolves paths through `realpath` and refuses anything outside
  the repository root — lexically *and* after symlink resolution.
- There are **no network calls** unless you explicitly pass `--ai <provider>`;
  with `--ai ollama` traffic stays on localhost.
- No telemetry, no analytics, nothing phones home.
- `--ref` creates throwaway git worktrees in the OS temp dir and removes them
  on exit (stale ones are GC'd after 24h).

To report a vulnerability, open a GitHub security advisory on this repository
or email the maintainer. Please do not open public issues for exploitable
problems.
