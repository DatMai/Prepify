import { describe, expect, it } from 'vitest';
import { scanReleaseBoundaries } from '../../scripts/releaseBoundaryScan.mjs';

const clean = {
  trackedFiles: ['AGENTS.md', 'README.md', 'src/main.ts'],
  migrationFiles: ['001_init.sql', '002_add_streak_leaderboard.sql'],
  existingPaths: ['AGENTS.md', 'README.md'],
  requiredPaths: ['AGENTS.md', 'README.md'],
};

describe('release boundary scan', () => {
  it('reports a tracked path under the private corpus root', () => {
    const issues = scanReleaseBoundaries({
      ...clean,
      trackedFiles: [...clean.trackedFiles, 'content/dsa.json'],
    });

    expect(issues).toEqual([{ code: 'tracked_content', detail: 'content/dsa.json' }]);
  });

  it('reports tracked environment files but allows the example file', () => {
    const issues = scanReleaseBoundaries({
      ...clean,
      trackedFiles: ['.env.local', 'server/.env', 'server/.env.example'],
    });

    expect(issues.map((issue) => issue.detail)).toEqual(['.env.local', 'server/.env']);
    expect(issues.every((issue) => issue.code === 'tracked_env')).toBe(true);
  });

  it('reports two migrations that share a numeric prefix', () => {
    const issues = scanReleaseBoundaries({
      ...clean,
      migrationFiles: ['013_add_journey_sync.sql', '013_extra.sql', '014_later.sql'],
    });

    expect(issues).toEqual([{ code: 'migration_duplicate_prefix', detail: '013' }]);
  });

  it('reports a required document that is not present', () => {
    const issues = scanReleaseBoundaries({
      ...clean,
      existingPaths: ['README.md'],
    });

    expect(issues).toEqual([{ code: 'missing_required_doc', detail: 'AGENTS.md' }]);
  });

  it('reports a legacy Claude surface left in the tree', () => {
    const issues = scanReleaseBoundaries({
      ...clean,
      trackedFiles: ['CLAUDE.md', '.claude/settings.json'],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'legacy_claude_surface',
      'legacy_claude_surface',
    ]);
  });

  it('reports nothing for a clean tracked tree and never echoes file contents', () => {
    const issues = scanReleaseBoundaries(clean);

    expect(issues).toEqual([]);
    for (const issue of scanReleaseBoundaries({
      ...clean,
      trackedFiles: ['content/secret-topic.json', '.env'],
    })) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'detail']);
      expect(issue.detail).not.toContain('secret explanation');
    }
  });
});
