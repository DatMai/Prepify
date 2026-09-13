import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Release boundary scan.
 *
 * Checks the things a release must never ship or forget, using path metadata
 * only. It never reads or prints a file's contents, so it stays safe to run in
 * CI and in front of a private corpus.
 */

const CORPUS_ROOT = 'content';
const LEGACY_CLAUDE_FILES = ['CLAUDE.md'];
const LEGACY_CLAUDE_PREFIX = '.claude/';
const ENV_EXAMPLE = /(^|\/)\.env\.example$/;
const MIGRATION_PREFIX = /^(\d+)_/;

/** Documents a release is not allowed to go out without. */
export const REQUIRED_PATHS = [
  'AGENTS.md',
  'README.md',
  'docs/ADR-001-obsidian-journey-sync.md',
  'docs/ADR-002-private-library-and-obsidian-projection.md',
  'docs/ADR-003-public-rss-feed.md',
  'docs/ADR-004-library-corpus-in-postgresql.md',
];

function basename(file) {
  return path.posix.basename(file);
}

export function scanReleaseBoundaries({
  trackedFiles = [],
  migrationFiles = [],
  existingPaths = [],
  requiredPaths = [],
}) {
  const issues = [];

  for (const file of trackedFiles) {
    if (file === CORPUS_ROOT || file.startsWith(`${CORPUS_ROOT}/`)) {
      issues.push({ code: 'tracked_content', detail: file });
    }
  }

  for (const file of trackedFiles) {
    const name = basename(file);
    const isEnvFile = name === '.env' || (name.startsWith('.env.') && !ENV_EXAMPLE.test(file));
    if (isEnvFile) issues.push({ code: 'tracked_env', detail: file });
  }

  const seenPrefixes = new Set();
  const duplicatePrefixes = new Set();
  for (const file of migrationFiles) {
    const match = MIGRATION_PREFIX.exec(basename(file));
    if (!match) continue;
    const prefix = match[1];
    if (seenPrefixes.has(prefix)) duplicatePrefixes.add(prefix);
    seenPrefixes.add(prefix);
  }
  for (const prefix of duplicatePrefixes) {
    issues.push({ code: 'migration_duplicate_prefix', detail: prefix });
  }

  for (const required of requiredPaths) {
    if (!existingPaths.includes(required)) {
      issues.push({ code: 'missing_required_doc', detail: required });
    }
  }

  for (const file of trackedFiles) {
    if (LEGACY_CLAUDE_FILES.includes(file) || file.startsWith(LEGACY_CLAUDE_PREFIX)) {
      issues.push({ code: 'legacy_claude_surface', detail: file });
    }
  }

  return issues;
}

function collect() {
  const repoRoot = process.cwd();
  const trackedFiles = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const migrationsDir = path.join(repoRoot, 'server', 'migrations');
  const migrationFiles = existsSync(migrationsDir) ? readdirSync(migrationsDir) : [];
  const existingPaths = REQUIRED_PATHS.filter((required) =>
    existsSync(path.join(repoRoot, required)),
  );

  return { trackedFiles, migrationFiles, existingPaths, requiredPaths: REQUIRED_PATHS };
}

function main() {
  const issues = scanReleaseBoundaries(collect());

  if (issues.length === 0) {
    console.log('Release boundary scan passed.');
    return;
  }

  for (const issue of issues) {
    // Paths and codes only: this never prints a file's contents.
    console.error(`[${issue.code}] ${issue.detail}`);
  }
  console.error(`Release boundary scan failed with ${issues.length} issue(s).`);
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (invokedDirectly) main();
