# Build Determinism Check (CI)

This repo runs a GitHub Actions workflow that builds key Docker images twice and checks whether the *resulting content* is deterministic.

## What is checked

The CI workflow is defined in [.github/workflows/build-determinism.yml](../.github/workflows/build-determinism.yml).

### Control Center: content hash (scoped)

For the Control Center image, the check computes a stable content hash over the application directory only:

- Scope: `/app/control-center`
- The check hashes per-file `sha256` values (sorted with a stable locale) and then hashes the resulting list again to get a single overall hash.

This avoids false negatives from OS-level filesystem noise (e.g. `/etc/alternatives`) and focuses on what the container actually runs.

#### Excludes (why they exist)

Some build artifacts are known to be volatile between builds even when runtime behavior is unchanged (e.g. Next.js manifests, caches, sourcemaps). These are excluded to make the determinism metric robust and explainable:

- `/app/control-center/.next/cache/**` (build cache)
- `**/*manifest*` (e.g. `prerender-manifest`, `routes-manifest`, `client-reference-manifest`)
- `**/*.map` (sourcemaps)
- `**/trace*` (trace artifacts)
- `**/*.log` (logs)

If the hashes differ, the workflow prints the first ~200 lines of a diff between the two per-file hash lists.

### MCP servers

For MCP images, the workflow compares Docker RootFS layer lists (`.RootFS.Layers`) rather than image `.Id` to avoid metadata-only drift.

## How to reproduce locally

From the repo root:

1) Build twice:

- `docker build --no-cache -t test-control-center:1 -f control-center/Dockerfile .`
- `docker build --no-cache -t test-control-center:2 -f control-center/Dockerfile .`

2) Compute the same scoped hashes:

- `docker run --rm test-control-center:1 sh -lc 'export TZ=UTC LC_ALL=C LANG=C; cd /app/control-center; find . -path "./.next/cache" -prune -o -type f ! -name "*manifest*" ! -name "*.map" ! -name "trace*" ! -name "*.log" -print0 | sort -z | xargs -0 sha256sum | sha256sum'`
- `docker run --rm test-control-center:2 sh -lc 'export TZ=UTC LC_ALL=C LANG=C; cd /app/control-center; find . -path "./.next/cache" -prune -o -type f ! -name "*manifest*" ! -name "*.map" ! -name "trace*" ! -name "*.log" -print0 | sort -z | xargs -0 sha256sum | sha256sum'`

If the two hashes match, the *included* container content is deterministic.
