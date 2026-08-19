#!/usr/bin/env node
/**
 * Installs this repo's tracked git hooks (hooks/*) into .git/hooks/ so every contributor gets the
 * same pre-push quality gate, without adding a husky/simple-git-hooks dependency for something
 * this small (docs/implementation-plan.md Ticket 1).
 *
 * Runs automatically via the "prepare" npm script on `npm install`. Safely no-ops outside a plain
 * git checkout — e.g. if this package is ever installed as a dependency (no .git at all), or run
 * inside a worktree (.git is a file, not a directory, there) — rather than failing `npm install`.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repoRoot, "hooks");
const gitDir = join(repoRoot, ".git");

if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) {
  // Not a plain git checkout — nothing safe to do here, so no-op rather than fail `npm install`.
  process.exit(0);
}

const gitHooksDir = join(gitDir, "hooks");
mkdirSync(gitHooksDir, { recursive: true });

for (const hook of readdirSync(sourceDir)) {
  const source = join(sourceDir, hook);
  const destination = join(gitHooksDir, hook);
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  console.log(`Installed git hook: ${hook}`);
}
